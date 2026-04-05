"""
ubpr_ingest.py

UBPR ingestion pipeline that syncs FFIEC data to Cloudflare R2 as Parquet files.

How it works:
    1. Read the last run metadata from R2 (timestamp, what was processed)
    2. If last run was less than 30 days ago, bail out early
    3. Ask the FFIEC API what quarters are actually available
    4. Compare against what we already have in R2
    5. Process newest-first until we either finish or hit the 9 GB budget
    6. Write updated metadata back to R2

Run from project root:
    python bigdata/ingestion/ubpr_ingest.py              # normal incremental run
    python bigdata/ingestion/ubpr_ingest.py --full       # backfill everything available
    python bigdata/ingestion/ubpr_ingest.py --dry-run    # see the plan without downloading
    python bigdata/ingestion/ubpr_ingest.py --force      # skip the monthly cooldown check
"""

import os
import io
import re
import json
import time
import zipfile
import logging
import argparse
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone

import boto3
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from botocore.exceptions import ClientError, EndpointConnectionError
from dotenv import load_dotenv
from ffiec_data_collector import FFIECDownloader, FileFormat

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

S3_ENDPOINT    = os.getenv("R2_ENDPOINT", "").rstrip("/")
AWS_ACCESS_KEY = os.getenv("R2_ACCESS_KEY_ID", "")
AWS_SECRET_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
BUCKET         = os.getenv("R2_BUCKET", "ffiec-data")

# 9 GB hard cap per run. R2 writes are free - this is a safety guard
# in case the FFIEC API starts returning unexpectedly large files.
BUDGET_GB    = float(os.getenv("INGEST_BUDGET_GB", "9.0"))
BUDGET_BYTES = BUDGET_GB * 1024 * 1024 * 1024

# Minimum days between full runs. Prevents accidental re-ingestion.
COOLDOWN_DAYS = int(os.getenv("INGEST_COOLDOWN_DAYS", "28"))

# Where we store run metadata inside the R2 bucket
METADATA_KEY = "ubpr/ingestion_metadata.json"

_REQUIRED_ENV = [
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
]


def validate_env():
    missing = [k for k in _REQUIRED_ENV if not os.getenv(k)]
    if missing:
        raise EnvironmentError(
            f"Cannot start - missing environment variables: {missing}\n"
            f"Check your .env file at bigdata/.env"
        )


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=AWS_ACCESS_KEY,
        aws_secret_access_key=AWS_SECRET_KEY,
        region_name="auto",
    )


def _r2_retry(fn, max_attempts: int = 5):
    """
    Retry wrapper for boto3 calls that hit the home network SSL reset bug.
    Cloudflare R2 drops SSL handshakes on residential connections (WinError 10054).
    Retrying with backoff resolves it in practice within 1-2 attempts.
    """
    from botocore.exceptions import ConnectionClosedError
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except (ConnectionClosedError, EndpointConnectionError, ConnectionResetError) as e:
            last_err = e
            wait = 3 * attempt
            logger.warning(
                f"R2 connection dropped (attempt {attempt}/{max_attempts}), "
                f"retrying in {wait}s..."
            )
            time.sleep(wait)
        except ClientError:
            raise
    raise RuntimeError(
        f"R2 connection failed after {max_attempts} attempts. "
        f"Last error: {last_err}. "
        f"Try on a different network or use a VPN."
    ) from last_err


def read_metadata(s3) -> dict:
    """
    Read the ingestion metadata JSON from R2.
    Returns an empty dict on first run (file does not exist yet).
    Retries on SSL resets which are common on residential networks with R2.
    """
    try:
        resp = _r2_retry(lambda: s3.get_object(Bucket=BUCKET, Key=METADATA_KEY))
        metadata = json.loads(resp["Body"].read().decode("utf-8"))
        logger.info(f"Last run: {metadata.get('last_run_utc', 'unknown')}")
        logger.info(f"Quarters in R2: {metadata.get('total_quarters_in_r2', 0)}")
        logger.info(f"Total data stored: {metadata.get('total_gb_stored', 0):.3f} GB")
        return metadata
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            logger.info("No metadata found - this looks like the first run.")
            return {}
        raise RuntimeError(f"Could not read metadata from R2: {e}") from e


def write_metadata(s3, metadata: dict):
    """
    Write updated ingestion metadata back to R2.
    We do this after every successful run so we always know the state.
    """
    metadata["last_run_utc"] = datetime.now(timezone.utc).isoformat()
    body = json.dumps(metadata, indent=2).encode("utf-8")
    try:
        s3.put_object(Bucket=BUCKET, Key=METADATA_KEY, Body=body, ContentType="application/json")
        logger.info("Metadata written to R2.")
    except Exception as e:
        # Don't crash the whole run over metadata - just warn
        logger.warning(f"Could not write metadata to R2 (non-fatal): {e}")


def check_cooldown(metadata: dict, force: bool) -> bool:
    """
    Returns True if we're within the cooldown window and should stop.
    The --force flag bypasses this for manual runs.
    """
    if force:
        logger.info("--force flag set, skipping cooldown check.")
        return False

    last_run_str = metadata.get("last_run_utc")
    if not last_run_str:
        return False

    try:
        last_run = datetime.fromisoformat(last_run_str)
        if last_run.tzinfo is None:
            last_run = last_run.replace(tzinfo=timezone.utc)
        days_since = (datetime.now(timezone.utc) - last_run).days

        if days_since < COOLDOWN_DAYS:
            logger.warning(
                f"Last run was {days_since} days ago. "
                f"Monthly cooldown is {COOLDOWN_DAYS} days. "
                f"Use --force to override."
            )
            return True

        logger.info(f"Last run was {days_since} days ago - proceeding.")
        return False
    except ValueError:
        logger.warning(f"Could not parse last_run_utc '{last_run_str}' - ignoring cooldown.")
        return False


def list_r2_quarters(s3) -> dict:
    """
    Scan the R2 bucket and return every quarter we have stored,
    along with the file size for each one.
    Returns: {"20251231": 33554432, "20250930": 31457280, ...}
    """
    stored = {}

    def _scan():
        paginator = s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=BUCKET, Prefix="ubpr/year=")
        result = {}
        for page in pages:
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if not key.endswith("/data.parquet"):
                    continue
                parts = key.split("/")
                if len(parts) != 4:
                    continue
                quarter = parts[2].replace("quarter=", "")
                if len(quarter) == 8 and quarter.isdigit():
                    result[quarter] = obj["Size"]
        return result

    try:
        stored = _r2_retry(_scan)
        total_gb = sum(stored.values()) / 1024 / 1024 / 1024
        logger.info(
            f"Found {len(stored)} quarters in R2, "
            f"total size: {total_gb:.2f} GB"
        )
        return stored

    except ClientError as e:
        raise RuntimeError(f"R2 error listing quarters: {e}") from e


def list_ffiec_available_quarters(start_year: int = 2001) -> list:
    """
    Generate all quarter dates that FFIEC has data for.

    Rather than calling an API that may or may not support listing periods,
    we generate dates from Q1 2001 (earliest UBPR XBRL data) up to one full
    quarter before today. FFIEC releases data ~45-60 days after quarter end,
    so stepping back one quarter is the conservative safe approach.

    The download step itself will fail gracefully if a quarter turns out to
    not be available yet - this just sets the upper bound safely.
    """
    from datetime import date as _date
    quarter_ends = {1: "0331", 2: "0630", 3: "0930", 4: "1231"}
    today = _date.today()

    current_q = (today.month - 1) // 3 + 1
    current_year = today.year

    # Step back one quarter - FFIEC data lags quarter end by ~45-60 days
    current_q -= 1
    if current_q == 0:
        current_q = 4
        current_year -= 1

    quarters = []
    year = current_year
    q = current_q

    while year > start_year or (year == start_year and q >= 1):
        quarters.append(f"{year}{quarter_ends[q]}")
        q -= 1
        if q == 0:
            q = 4
            year -= 1

    logger.info(
        f"Target quarters: {quarters[0]} (latest) to {quarters[-1]} (oldest), "
        f"{len(quarters)} total"
    )
    return quarters


def ffiec_period_to_quarter_date(period_str: str) -> str:
    """
    Convert FFIEC period string "12/31/2025" to our storage format "20251231".
    """
    try:
        dt = datetime.strptime(period_str.strip(), "%m/%d/%Y")
        return dt.strftime("%Y%m%d")
    except ValueError as e:
        raise ValueError(
            f"Cannot parse FFIEC period '{period_str}' - expected MM/DD/YYYY format"
        ) from e


def quarter_date_to_ffiec_period(quarter_date: str) -> str:
    """
    Convert our storage format "20251231" to FFIEC format "12/31/2025".
    """
    try:
        dt = datetime.strptime(quarter_date, "%Y%m%d")
        return dt.strftime("%m/%d/%Y")
    except ValueError as e:
        raise ValueError(
            f"Cannot parse quarter date '{quarter_date}' - expected YYYYMMDD format"
        ) from e


def parse_xbrl_zip(zip_path: str, quarter_date: str) -> pd.DataFrame:
    """
    Parse the FFIEC XBRL zip file into a DataFrame with one row per institution.
    Each row has rssd_id, quarter_date, and all UBPR ratio columns that appear
    in the XML for that institution in that reporting period.

    The XBRL files use contextRef to tie each value to a specific date,
    so we filter strictly on the quarter's date to avoid picking up prior period values.
    """
    formatted_date = f"{quarter_date[0:4]}-{quarter_date[4:6]}-{quarter_date[6:8]}"
    target_context_suffix = f"_{formatted_date}"
    records = []
    parse_errors = 0

    with zipfile.ZipFile(zip_path, "r") as z:
        xml_files = [f for f in z.namelist() if f.endswith(".xml")]
        logger.info(f"Parsing {len(xml_files)} institution XML files in {quarter_date}...")

        for xml_file in xml_files:
            try:
                with z.open(xml_file) as f:
                    tree = ET.parse(f)
                    root = tree.getroot()

                # Institution RSSD ID is embedded in the filename
                # Format: "FI 852218(ID RSSD) 20251231.xml"
                rssd_match = re.search(r"FI (\d+)\(ID RSSD\)", xml_file)
                if not rssd_match:
                    logger.debug(f"Could not extract RSSD ID from filename: {xml_file}")
                    continue
                rssd_id = rssd_match.group(1)

                record = {"rssd_id": rssd_id, "quarter_date": quarter_date}

                for elem in root.iter():
                    tag = elem.tag
                    context_ref = elem.get("contextRef", "")
                    if (
                        "UBPR" in tag
                        and context_ref.endswith(target_context_suffix)
                        and elem.text
                        and elem.text.strip()
                    ):
                        # Strip namespace prefix to get just the UBPR code
                        ubpr_code = tag.split("}")[-1] if "}" in tag else tag.split(":")[-1]
                        record[ubpr_code] = elem.text.strip()

                if len(record) > 2:
                    records.append(record)

            except ET.ParseError as e:
                parse_errors += 1
                logger.debug(f"XML parse error in {xml_file}: {e}")
                continue
            except Exception as e:
                parse_errors += 1
                logger.warning(f"Unexpected error parsing {xml_file}: {e}")
                continue

    if parse_errors > 0:
        logger.warning(f"{parse_errors} files failed to parse (out of {len(xml_files)})")

    if not records:
        raise ValueError(
            f"No institution records extracted for {quarter_date}. "
            f"The zip may be empty, corrupt, or the date format may have changed."
        )

    df = pd.DataFrame(records)
    logger.info(
        f"Parsed {len(df):,} institutions with {len(df.columns)} fields "
        f"for quarter {quarter_date}"
    )
    return df


def download_quarter_from_ffiec(quarter_date: str) -> pd.DataFrame:
    """
    Download the XBRL zip for a quarter from FFIEC and parse it.
    Cleans up the temp zip file whether parsing succeeds or fails.
    """
    period_str = quarter_date_to_ffiec_period(quarter_date)
    logger.info(f"Downloading {period_str} from FFIEC...")

    downloader = FFIECDownloader()
    result = downloader.download_ubpr_single_period(period_str, format=FileFormat.XBRL)

    if not result.success:
        raise RuntimeError(
            f"FFIEC download failed for {period_str}: {result.error_message}"
        )

    if not result.file_path or not os.path.exists(result.file_path):
        raise RuntimeError(
            f"FFIEC download reported success but no file found at {result.file_path}"
        )

    file_size_mb = os.path.getsize(result.file_path) / 1024 / 1024
    logger.info(f"Downloaded {file_size_mb:.1f} MB zip for {quarter_date}")

    try:
        df = parse_xbrl_zip(str(result.file_path), quarter_date)
    finally:
        try:
            os.remove(result.file_path)
        except OSError:
            pass

    return df


def upload_to_r2(s3, df: pd.DataFrame, quarter_date: str) -> int:
    """
    Serialize DataFrame to Parquet and upload to R2.
    Uses multipart upload for files over 10 MB to handle network interruptions.
    Returns the number of bytes written.
    """
    year = quarter_date[:4]
    key  = f"ubpr/year={year}/quarter={quarter_date}/data.parquet"

    buffer = io.BytesIO()
    table  = pa.Table.from_pandas(df)
    # Snappy gives a good balance of compression ratio vs CPU time
    pq.write_table(table, buffer, compression="snappy")
    buffer.seek(0)
    data       = buffer.getvalue()
    total_size = len(data)
    size_mb    = total_size / 1024 / 1024

    logger.info(f"Uploading {size_mb:.1f} MB Parquet to R2 ({key})")

    chunk_size = 10 * 1024 * 1024

    if total_size <= chunk_size:
        _upload_single(s3, key, data)
    else:
        _upload_multipart(s3, key, data, chunk_size)

    logger.info(
        f"Uploaded {quarter_date}: "
        f"{len(df):,} institutions, {len(df.columns)} columns, {size_mb:.1f} MB"
    )
    return total_size


def _upload_single(s3, key: str, data: bytes, max_attempts: int = 3):
    """Single PUT upload with retry for small files."""
    for attempt in range(1, max_attempts + 1):
        try:
            s3.put_object(Bucket=BUCKET, Key=key, Body=data)
            return
        except (ClientError, EndpointConnectionError) as e:
            if attempt == max_attempts:
                raise RuntimeError(
                    f"Upload failed after {max_attempts} attempts for {key}: {e}"
                ) from e
            wait = 5 * attempt
            logger.warning(f"Upload attempt {attempt} failed, retrying in {wait}s: {e}")
            time.sleep(wait)
            s3 = get_s3_client()


def _upload_multipart(s3, key: str, data: bytes, chunk_size: int, max_attempts: int = 3):
    """Multipart upload with per-part retry for large files."""
    mpu       = s3.create_multipart_upload(Bucket=BUCKET, Key=key)
    upload_id = mpu["UploadId"]
    parts     = []

    try:
        chunks = range(0, len(data), chunk_size)
        for part_num, offset in enumerate(chunks, start=1):
            chunk = data[offset:offset + chunk_size]
            for attempt in range(1, max_attempts + 1):
                try:
                    resp = s3.upload_part(
                        Bucket=BUCKET, Key=key,
                        UploadId=upload_id, PartNumber=part_num, Body=chunk,
                    )
                    parts.append({"PartNumber": part_num, "ETag": resp["ETag"]})
                    logger.info(
                        f"Part {part_num}/{len(chunks)} uploaded "
                        f"({len(chunk)/1024/1024:.1f} MB)"
                    )
                    break
                except (ClientError, EndpointConnectionError) as e:
                    if attempt == max_attempts:
                        raise RuntimeError(
                            f"Part {part_num} failed after {max_attempts} attempts: {e}"
                        ) from e
                    wait = 5 * attempt
                    logger.warning(
                        f"Part {part_num} attempt {attempt} failed, "
                        f"retrying in {wait}s: {e}"
                    )
                    time.sleep(wait)
                    s3 = get_s3_client()

        s3.complete_multipart_upload(
            Bucket=BUCKET, Key=key,
            MultipartUpload={"Parts": parts}, UploadId=upload_id,
        )

    except Exception as e:
        logger.error(f"Multipart upload failed, aborting: {e}")
        try:
            s3.abort_multipart_upload(Bucket=BUCKET, Key=key, UploadId=upload_id)
        except Exception as abort_err:
            logger.warning(f"Could not abort multipart upload (may need manual cleanup): {abort_err}")
        raise


def run(full_history: bool = False, dry_run: bool = False, force: bool = False):
    validate_env()
    s3 = get_s3_client()

    logger.info("=" * 70)
    logger.info("UBPR Ingestion Pipeline")
    logger.info(f"Mode      : {'FULL HISTORY' if full_history else 'INCREMENTAL'}")
    logger.info(f"Dry run   : {dry_run}")
    logger.info(f"Force     : {force}")
    logger.info(f"Budget    : {BUDGET_GB} GB per run")
    logger.info(f"Cooldown  : {COOLDOWN_DAYS} days between runs")
    logger.info(f"Endpoint  : {S3_ENDPOINT}")
    logger.info(f"Bucket    : {BUCKET}")
    logger.info("=" * 70)

    # Step 1: Read what we know about previous runs
    metadata = read_metadata(s3)

    # Step 2: Enforce monthly cooldown unless --force or --full
    if not full_history and check_cooldown(metadata, force):
        logger.info("Exiting due to cooldown. Use --force to override.")
        return

    # Step 3: What do we already have in R2?
    logger.info("Scanning R2 for existing quarters...")
    r2_quarters = list_r2_quarters(s3)
    logger.info(
        f"R2 has {len(r2_quarters)} quarters stored, "
        f"total {sum(r2_quarters.values())/1024/1024/1024:.2f} GB"
    )

    # Step 4: What does the FFIEC API actually have available?
    ffiec_quarter_dates = list_ffiec_available_quarters()

    logger.info(
        f"FFIEC has {len(ffiec_quarter_dates)} available quarters. "
        f"Range: {ffiec_quarter_dates[-1]} to {ffiec_quarter_dates[0]}"
    )

    # Step 5: Determine what needs to be ingested
    if full_history:
        # Everything FFIEC has that we don't
        to_ingest = [q for q in ffiec_quarter_dates if q not in r2_quarters]
    else:
        # Only the most recent quarters we're missing (last 2 years = 8 quarters)
        # This handles the normal case of a new quarter becoming available
        recent = ffiec_quarter_dates[:8]
        to_ingest = [q for q in recent if q not in r2_quarters]

    # Always process newest first so we have the most recent data even if budget runs out
    to_ingest.sort(reverse=True)

    if not to_ingest:
        logger.info("R2 is fully up to date. Nothing to ingest.")
        write_metadata(s3, {
            **metadata,
            "total_quarters_in_r2": len(r2_quarters),
            "total_gb_stored": sum(r2_quarters.values()) / 1024 / 1024 / 1024,
            "last_run_result": "up_to_date",
        })
        return

    logger.info(
        f"{len(to_ingest)} quarters to ingest: "
        f"{to_ingest[0]} (newest) → {to_ingest[-1]} (oldest)"
    )

    if dry_run:
        logger.info("[DRY RUN] Would ingest the following quarters:")
        for q in to_ingest:
            size_str = (
                f"{r2_quarters[q]/1024/1024:.1f} MB (exists)"
                if q in r2_quarters else "~32 MB (estimated)"
            )
            logger.info(f"  {q}  {size_str}")
        estimated_gb = len(to_ingest) * 32 / 1024
        logger.info(f"[DRY RUN] Estimated total: {estimated_gb:.2f} GB")
        return

    # Step 6: Ingest - newest first, stop at budget
    bytes_written = 0
    succeeded     = []
    failed        = []
    deferred      = []
    run_start     = time.time()

    for i, quarter_date in enumerate(to_ingest, 1):
        gb_used      = bytes_written / 1024 / 1024 / 1024
        gb_remaining = BUDGET_GB - gb_used

        logger.info("-" * 70)
        logger.info(
            f"[{i}/{len(to_ingest)}] Quarter: {quarter_date} | "
            f"Used: {gb_used:.3f} GB | Remaining: {gb_remaining:.3f} GB"
        )

        # A quarter is roughly 30-40 MB. If we have less than 50 MB left, stop.
        if gb_remaining < 0.050:
            logger.warning(
                f"Budget nearly exhausted ({gb_remaining*1024:.0f} MB left). "
                f"Deferring {len(to_ingest) - i + 1} quarters to the next run."
            )
            deferred.extend(to_ingest[i - 1:])
            break

        try:
            t0 = time.time()

            df = download_quarter_from_ffiec(quarter_date)

            bytes_this_quarter = upload_to_r2(s3, df, quarter_date)
            bytes_written      += bytes_this_quarter
            elapsed             = time.time() - t0

            succeeded.append(quarter_date)
            logger.info(
                f"Done in {elapsed:.1f}s | "
                f"This quarter: {bytes_this_quarter/1024/1024:.1f} MB | "
                f"Total written: {bytes_written/1024/1024/1024:.3f} GB"
            )

        except Exception as e:
            logger.error(f"Failed to process {quarter_date}: {e}")
            failed.append(quarter_date)
            # Don't stop the whole run because one quarter failed
            # It will be picked up next run
            continue

    total_elapsed = time.time() - run_start

    # Step 7: Update R2 metadata so next run knows what happened
    updated_r2 = list_r2_quarters(s3)
    write_metadata(s3, {
        "last_run_utc": datetime.now(timezone.utc).isoformat(),
        "last_run_mode": "full_history" if full_history else "incremental",
        "last_run_succeeded": succeeded,
        "last_run_failed": failed,
        "last_run_deferred": deferred,
        "last_run_bytes_written": bytes_written,
        "last_run_duration_seconds": round(total_elapsed),
        "total_quarters_in_r2": len(updated_r2),
        "total_gb_stored": sum(updated_r2.values()) / 1024 / 1024 / 1024,
        "last_run_result": "completed" if not failed else "completed_with_errors",
    })

    logger.info("=" * 70)
    logger.info("SUMMARY")
    logger.info(f"  Succeeded   : {len(succeeded)} quarters  {succeeded[:3]}{'...' if len(succeeded) > 3 else ''}")
    logger.info(f"  Failed      : {len(failed)}  {failed if failed else ''}")
    logger.info(f"  Deferred    : {len(deferred)} quarters (budget limit)")
    logger.info(f"  Written     : {bytes_written/1024/1024/1024:.3f} GB")
    logger.info(f"  Time        : {total_elapsed/60:.1f} minutes")
    logger.info(f"  R2 total    : {len(updated_r2)} quarters, {sum(updated_r2.values())/1024/1024/1024:.2f} GB")
    if deferred:
        logger.info(f"  Next run    : will pick up {deferred[0]} through {deferred[-1]}")
    logger.info("=" * 70)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="UBPR ingestion pipeline - syncs FFIEC data to Cloudflare R2"
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help=(
            "Ingest full history - everything FFIEC has that is not in R2. "
            "Use this for the initial backfill. Subsequent runs should be incremental."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be ingested without downloading or uploading anything.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help=(
            "Skip the monthly cooldown check. "
            "Useful for manual re-runs or testing."
        ),
    )
    parser.add_argument(
        "--budget-gb",
        type=float,
        default=None,
        help=f"Override the per-run budget cap in GB (default: {BUDGET_GB})",
    )
    args = parser.parse_args()

    if args.budget_gb is not None:
        BUDGET_GB    = args.budget_gb
        BUDGET_BYTES = BUDGET_GB * 1024 * 1024 * 1024
        logger.info(f"Budget overridden to {BUDGET_GB} GB")

    run(
        full_history=args.full,
        dry_run=args.dry_run,
        force=args.force,
    )