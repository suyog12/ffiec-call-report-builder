"""
ubpr_ingest.py

UBPR ingestion pipeline — syncs FFIEC quarterly data to Cloudflare R2 as Parquet files.
Processing is handled by PySpark for scalable, parallelizable transformation.
Designed to run on a Linux environment (GitHub Actions Ubuntu runner) where
PySpark initializes without the Windows WinUtils/HADOOP_HOME dependency.

Pipeline:
    1. Read ingestion metadata from R2 (last run state, quarters already stored)
    2. Scan R2 to inventory all quarters currently stored
    3. Query FFIEC to determine all available quarters
    4. Compute the delta — quarters available in FFIEC but not yet in R2
    5. Exit early if R2 is already current (daily runs will hit this most days)
    6. Download each missing quarter as an XBRL ZIP from FFIEC CDR API
    7. Parse institution XML files using PySpark (distributed, parallelized)
    8. Write output as Snappy-compressed Parquet to Cloudflare R2 via S3A
    9. Write updated metadata back to R2

Run from project root:
    python bigdata/ingestion/ubpr_ingest.py              # incremental (last 2 years)
    python bigdata/ingestion/ubpr_ingest.py --full       # full backfill from 2001
    python bigdata/ingestion/ubpr_ingest.py --dry-run    # plan only, no downloads
    python bigdata/ingestion/ubpr_ingest.py --force      # skip delta check
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import time
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone
from typing import Optional

import boto3
from botocore.exceptions import ClientError, EndpointConnectionError
from dotenv import load_dotenv
from ffiec_data_collector import FFIECDownloader, FileFormat
from pyspark.sql import SparkSession, DataFrame
from pyspark.sql.types import StringType, StructField, StructType

# Logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ubpr_ingest")

# Environment

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

R2_ENDPOINT = os.getenv("R2_ENDPOINT", "").rstrip("/")
ACCESS_KEY  = os.getenv("R2_ACCESS_KEY_ID", "")
SECRET_KEY  = os.getenv("R2_SECRET_ACCESS_KEY", "")
BUCKET      = os.getenv("R2_BUCKET", "ffiec-data")
FFIEC_USER  = os.getenv("FFIEC_USER_ID", "")
FFIEC_TOKEN = os.getenv("FFIEC_PWS_TOKEN", "")

# S3A connector needs hostname only — no scheme, no trailing slash
_S3A_ENDPOINT = (
    R2_ENDPOINT
    .replace("https://", "")
    .replace("http://", "")
    .rstrip("/")
)

# Pipeline control
BUDGET_GB    = float(os.getenv("INGEST_BUDGET_GB", "9.0"))
BUDGET_BYTES = BUDGET_GB * 1024 ** 3
METADATA_KEY = "ubpr/ingestion_metadata.json"

_REQUIRED_ENV = [
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "FFIEC_USER_ID",
    "FFIEC_PWS_TOKEN",
]

# Validation

def validate_env() -> None:
    """Fail fast if any required environment variable is missing."""
    missing = [k for k in _REQUIRED_ENV if not os.getenv(k)]
    if missing:
        raise EnvironmentError(
            f"Missing required environment variables: {missing}\n"
            f"Set them in bigdata/.env or as GitHub Actions secrets."
        )


# S3 / R2 client

def get_s3_client():
    """Return a boto3 S3 client pointed at Cloudflare R2."""
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        region_name="auto",
    )


def _r2_retry(fn, max_attempts: int = 5):
    """
    Retry wrapper for boto3 calls that hit transient SSL resets.
    Cloudflare R2 occasionally drops SSL handshakes on residential connections.
    Exponential-ish backoff (3s, 6s, 9s...) resolves it within 1-2 attempts.
    """
    from botocore.exceptions import ConnectionClosedError

    last_err: Optional[Exception] = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except (ConnectionClosedError, EndpointConnectionError, ConnectionResetError) as exc:
            last_err = exc
            wait = 3 * attempt
            logger.warning(
                "R2 connection dropped (attempt %d/%d), retrying in %ds: %s",
                attempt, max_attempts, wait, exc,
            )
            time.sleep(wait)
        except ClientError:
            raise
    raise RuntimeError(
        f"R2 connection failed after {max_attempts} attempts. Last error: {last_err}. "
        f"Try on a different network or use a VPN."
    ) from last_err


# Metadata

def read_metadata(s3) -> dict:
    """
    Read the ingestion run metadata JSON from R2.
    Returns an empty dict on first run (key does not yet exist).
    """
    try:
        resp     = _r2_retry(lambda: s3.get_object(Bucket=BUCKET, Key=METADATA_KEY))
        metadata = json.loads(resp["Body"].read().decode("utf-8"))
        logger.info("Last run        : %s", metadata.get("last_run_utc", "unknown"))
        logger.info("Quarters in R2  : %d", metadata.get("total_quarters_in_r2", 0))
        logger.info("Total stored    : %.3f GB", metadata.get("total_gb_stored", 0.0))
        return metadata
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        if code in ("NoSuchKey", "404"):
            logger.info("No metadata found — treating this as the first run.")
            return {}
        raise RuntimeError(f"Could not read metadata from R2: {exc}") from exc


def write_metadata(s3, metadata: dict) -> None:
    """
    Persist updated ingestion metadata to R2.
    Non-fatal — a metadata write failure does not abort the run.
    """
    metadata["last_run_utc"] = datetime.now(timezone.utc).isoformat()
    body = json.dumps(metadata, indent=2).encode("utf-8")
    try:
        s3.put_object(
            Bucket=BUCKET,
            Key=METADATA_KEY,
            Body=body,
            ContentType="application/json",
        )
        logger.info("Metadata written to R2.")
    except Exception as exc:
        logger.warning("Could not write metadata to R2 (non-fatal): %s", exc)


# Delta check (replaces time-based cooldown)

def should_skip_run(
    r2_quarters: dict,
    ffiec_quarters: list[str],
    force: bool,
) -> bool:
    """
    Determine whether this run has any work to do.

    The pipeline runs on a daily schedule — most days FFIEC will not have
    published new data since the last run. Rather than a time-based cooldown,
    we do a data-based check: compare what R2 has against what FFIEC has
    available and skip immediately if they are in sync.

    This check completes in under 5 seconds (two lightweight API calls) and
    avoids spinning up PySpark or downloading anything on no-op days.

    The --force flag bypasses this check for manual re-runs or debugging.
    """
    if force:
        logger.info("--force flag set — skipping delta check.")
        return False

    # Check only the last 2 years (8 quarters) — the window where new data appears
    recent  = ffiec_quarters[:8]
    missing = [q for q in recent if q not in r2_quarters]

    if not missing:
        logger.info(
            "R2 is fully up to date with FFIEC — nothing to ingest. "
            "Skipping run. (Daily check completed in seconds.)"
        )
        return True

    logger.info(
        "%d quarter(s) available in FFIEC not yet in R2: %s",
        len(missing), missing[:4],
    )
    return False


# R2 inventory

def list_r2_quarters(s3) -> dict:
    """
    Scan the R2 bucket and return all stored quarters with their file sizes.
    Returns: {"20251231": 33554432, "20250930": 31457280, ...}
    """
    def _scan() -> dict:
        stored: dict = {}
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=BUCKET, Prefix="ubpr/year="):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if not key.endswith("/data.parquet"):
                    continue
                parts = key.split("/")
                if len(parts) != 4:
                    continue
                quarter = parts[2].replace("quarter=", "")
                if len(quarter) == 8 and quarter.isdigit():
                    stored[quarter] = obj["Size"]
        return stored

    try:
        stored   = _r2_retry(_scan)
        total_gb = sum(stored.values()) / 1024 ** 3
        logger.info(
            "R2 inventory    : %d quarters, %.2f GB total",
            len(stored), total_gb,
        )
        return stored
    except ClientError as exc:
        raise RuntimeError(f"R2 error listing quarters: {exc}") from exc


# FFIEC quarter list

def list_ffiec_available_quarters(start_year: int = 2001) -> list[str]:
    """
    Generate all FFIEC quarter-end dates from start_year up to one full quarter
    before today. Stepping back one quarter accounts for the FFIEC's ~45-60 day
    publication lag after quarter end.
    Returns a list of YYYYMMDD strings, newest first.
    """
    quarter_ends = {1: "0331", 2: "0630", 3: "0930", 4: "1231"}
    today        = date.today()
    current_q    = (today.month - 1) // 3 + 1
    current_year = today.year

    current_q -= 1
    if current_q == 0:
        current_q    = 4
        current_year -= 1

    quarters: list[str] = []
    year, q = current_year, current_q
    while year > start_year or (year == start_year and q >= 1):
        quarters.append(f"{year}{quarter_ends[q]}")
        q -= 1
        if q == 0:
            q    = 4
            year -= 1

    logger.info(
        "FFIEC available : %d quarters (%s → %s)",
        len(quarters), quarters[-1], quarters[0],
    )
    return quarters


def quarter_date_to_ffiec_period(quarter_date: str) -> str:
    """Convert internal format '20251231' to FFIEC API format '12/31/2025'."""
    return datetime.strptime(quarter_date, "%Y%m%d").strftime("%m/%d/%Y")


# SparkSession factory

def get_spark_session(quarter_date: str) -> SparkSession:
    """
    Build a SparkSession configured for writing Parquet to Cloudflare R2
    via the S3A connector. S3A path-style access is required — R2 does not
    support virtual-hosted style URLs.

    Java heap is capped at 4g to stay within GitHub Actions runner limits.
    The session is named per quarter so logs are easy to correlate.
    Spark is initialized once per pipeline run and reused across all quarters.
    """
    return (
        SparkSession.builder
        .appName(f"UBPR_Ingestion_{quarter_date}")
        .config("spark.driver.memory",                    "4g")
        .config("spark.sql.parquet.compression.codec",    "snappy")
        .config("spark.hadoop.fs.s3a.endpoint",           _S3A_ENDPOINT)
        .config("spark.hadoop.fs.s3a.access.key",         ACCESS_KEY)
        .config("spark.hadoop.fs.s3a.secret.key",         SECRET_KEY)
        .config("spark.hadoop.fs.s3a.path.style.access",  "true")
        .config("spark.hadoop.fs.s3a.impl",               "org.apache.hadoop.fs.s3a.S3AFileSystem")
        .config(
            "spark.hadoop.fs.s3a.aws.credentials.provider",
            "org.apache.hadoop.fs.s3a.SimpleAWSCredentialsProvider",
        )
        .getOrCreate()
    )


# XBRL parsing

def _parse_single_xml(xml_bytes: bytes, quarter_date: str) -> Optional[dict]:
    """
    Parse a single institution XBRL XML byte string into a flat dict.
    Returns None if the file cannot be parsed or yields no UBPR fields.

    contextRef filtering ensures only current-period values are extracted —
    XBRL documents embed prior-period comparative values alongside current ones,
    which would corrupt the dataset if included.
    """
    formatted_date        = f"{quarter_date[:4]}-{quarter_date[4:6]}-{quarter_date[6:8]}"
    target_context_suffix = f"_{formatted_date}"

    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        logger.debug("XML parse error (skipping): %s", exc)
        return None

    record: dict = {}
    for elem in root.iter():
        tag         = elem.tag
        context_ref = elem.get("contextRef", "")
        if (
            "UBPR" in tag
            and context_ref.endswith(target_context_suffix)
            and elem.text
            and elem.text.strip()
        ):
            # Strip XML namespace prefix to get the bare UBPR code
            # e.g. "{http://...}UBPR2170" -> "UBPR2170"
            ubpr_code         = tag.split("}")[-1] if "}" in tag else tag.split(":")[-1]
            record[ubpr_code] = elem.text.strip()

    return record if record else None


def parse_xbrl_zip_to_records(zip_path: str, quarter_date: str) -> list[dict]:
    """
    Unzip the FFIEC XBRL archive and parse every institution XML file.
    Extracts the RSSD ID from each filename, parses the XML, and returns
    a list of flat dicts suitable for conversion to a Spark DataFrame.

    Filename pattern: "FI {RSSD_ID}(ID RSSD) {YYYYMMDD}.xml"
    """
    records: list[dict] = []
    parse_errors: int   = 0
    rssd_pattern        = re.compile(r"FI (\d+)\(ID RSSD\)")

    with zipfile.ZipFile(zip_path, "r") as zf:
        xml_files = [f for f in zf.namelist() if f.endswith(".xml")]
        logger.info(
            "Parsing %d institution XML files for quarter %s ...",
            len(xml_files), quarter_date,
        )

        for xml_file in xml_files:
            rssd_match = rssd_pattern.search(xml_file)
            if not rssd_match:
                logger.debug("Could not extract RSSD ID from filename: %s", xml_file)
                continue

            rssd_id = rssd_match.group(1)

            try:
                xml_bytes = zf.read(xml_file)
            except Exception as exc:
                logger.warning("Could not read %s from ZIP: %s", xml_file, exc)
                parse_errors += 1
                continue

            parsed = _parse_single_xml(xml_bytes, quarter_date)
            if parsed:
                parsed["rssd_id"]      = rssd_id
                parsed["quarter_date"] = quarter_date
                records.append(parsed)
            else:
                parse_errors += 1

    logger.info(
        "Parse complete  : %d institutions extracted, %d files skipped",
        len(records), parse_errors,
    )

    if not records:
        raise ValueError(
            f"No institution records extracted for {quarter_date}. "
            f"The ZIP may be empty, corrupt, or the XBRL format may have changed."
        )

    return records


# FFIEC download

def download_quarter_from_ffiec(quarter_date: str) -> str:
    """
    Download the XBRL ZIP for a quarter from the FFIEC CDR API.
    Returns the local file path of the downloaded ZIP.
    Raises RuntimeError on download failure.
    """
    period_str = quarter_date_to_ffiec_period(quarter_date)
    logger.info("Downloading %s from FFIEC ...", period_str)

    downloader = FFIECDownloader()
    result     = downloader.download_ubpr_single_period(period_str, format=FileFormat.XBRL)

    if not result.success:
        raise RuntimeError(
            f"FFIEC download failed for {period_str}: {result.error_message}"
        )

    if not result.file_path or not os.path.exists(str(result.file_path)):
        raise RuntimeError(
            f"FFIEC download reported success but no file found at {result.file_path}"
        )

    size_mb = os.path.getsize(str(result.file_path)) / 1024 ** 2
    logger.info("Downloaded      : %.1f MB  (%s)", size_mb, result.file_path)
    return str(result.file_path)


# PySpark processing and R2 write

def process_and_upload_with_spark(
    records: list[dict],
    quarter_date: str,
    spark: SparkSession,
) -> int:
    """
    Convert parsed institution records to a Spark DataFrame and write
    Snappy-compressed Parquet directly to Cloudflare R2 via S3A.

    All UBPR columns are StringType — matching the raw text values from XBRL.
    The write is coalesced to a single file to match the one-file-per-quarter
    layout expected by the DuckDB query engine in query_engine.py.

    Returns the approximate bytes written (estimated from record and column
    counts since S3A write does not return byte counts directly).
    """
    year    = quarter_date[:4]
    s3_path = f"s3a://{BUCKET}/ubpr/year={year}/quarter={quarter_date}/data.parquet"

    logger.info("Building Spark DataFrame from %d records ...", len(records))

    # Derive a unified schema from all records — columns vary across institutions
    # as not every UBPR code appears in every institution's filing
    all_keys: set[str] = set()
    for record in records:
        all_keys.update(record.keys())

    schema = StructType([
        StructField(col, StringType(), nullable=True)
        for col in sorted(all_keys)
    ])

    # Align every record to the full schema — missing columns become None
    aligned = [
        {col: record.get(col) for col in all_keys}
        for record in records
    ]

    spark_df: DataFrame = spark.createDataFrame(aligned, schema=schema)

    logger.info(
        "Spark DataFrame : %d rows x %d columns",
        spark_df.count(), len(spark_df.columns),
    )

    logger.info("Writing Parquet to %s ...", s3_path)

    (
        spark_df
        .coalesce(1)                    # one file per quarter — required by query engine
        .write
        .mode("overwrite")
        .option("compression", "snappy")
        .parquet(s3_path)
    )

    logger.info("Write complete  : %s", s3_path)

    # Estimate bytes written — S3A does not return a byte count on write
    estimated_bytes = len(records) * len(all_keys) * 8
    return estimated_bytes


# Main pipeline

def run(
    full_history: bool = False,
    dry_run: bool      = False,
    force: bool        = False,
) -> None:
    validate_env()

    s3 = get_s3_client()

    logger.info("=" * 70)
    logger.info("UBPR Ingestion Pipeline (PySpark)")
    logger.info("Mode      : %s", "FULL HISTORY" if full_history else "INCREMENTAL")
    logger.info("Dry run   : %s", dry_run)
    logger.info("Force     : %s", force)
    logger.info("Budget    : %.1f GB per run", BUDGET_GB)
    logger.info("Endpoint  : %s", R2_ENDPOINT)
    logger.info("Bucket    : %s", BUCKET)
    logger.info("=" * 70)

    # Step 1 — Read previous run state
    metadata = read_metadata(s3)

    # Step 2 — Inventory R2
    logger.info("Scanning R2 for existing quarters ...")
    r2_quarters = list_r2_quarters(s3)

    # Step 3 — Determine what FFIEC has available
    ffiec_quarters = list_ffiec_available_quarters()

    # Step 4 — Data-based delta check
    # Skips the run immediately if R2 is already current.
    # This is the key guard for the daily schedule — most days FFIEC will not
    # have published a new quarter since the last successful run.
    if not full_history and should_skip_run(r2_quarters, ffiec_quarters, force):
        write_metadata(s3, {
            **metadata,
            "total_quarters_in_r2" : len(r2_quarters),
            "total_gb_stored"      : sum(r2_quarters.values()) / 1024 ** 3,
            "last_run_result"      : "up_to_date",
        })
        return

    # Step 5 — Compute ingestion list
    if full_history:
        to_ingest = [q for q in ffiec_quarters if q not in r2_quarters]
    else:
        recent    = ffiec_quarters[:8]   # last 2 years
        to_ingest = [q for q in recent if q not in r2_quarters]

    to_ingest.sort(reverse=True)   # always process newest first

    if not to_ingest:
        logger.info("R2 is fully up to date. Nothing to ingest.")
        return

    logger.info(
        "%d quarters to ingest: %s (newest) → %s (oldest)",
        len(to_ingest), to_ingest[0], to_ingest[-1],
    )

    # Dry run — show plan and exit without downloading or writing anything
    if dry_run:
        logger.info("[DRY RUN] Would ingest the following quarters:")
        for q in to_ingest:
            status = (
                f"{r2_quarters[q] / 1024 / 1024:.1f} MB (exists)"
                if q in r2_quarters
                else "~32 MB (new)"
            )
            logger.info("  %s  %s", q, status)
        logger.info("[DRY RUN] Estimated total: %.2f GB", len(to_ingest) * 32 / 1024)
        return

    # Steps 6-8 — Download, parse with PySpark, upload to R2
    bytes_written: int            = 0
    succeeded:     list[str]      = []
    failed:        list[str]      = []
    deferred:      list[str]      = []
    run_start:     float          = time.time()
    spark: Optional[SparkSession] = None

    for i, quarter_date in enumerate(to_ingest, 1):
        gb_used      = bytes_written / 1024 ** 3
        gb_remaining = BUDGET_GB - gb_used

        logger.info("-" * 70)
        logger.info(
            "[%d/%d] Quarter: %s | Used: %.3f GB | Remaining: %.3f GB",
            i, len(to_ingest), quarter_date, gb_used, gb_remaining,
        )

        if gb_remaining < 0.050:
            logger.warning(
                "Budget nearly exhausted (%.0f MB left). Deferring %d quarters.",
                gb_remaining * 1024, len(to_ingest) - i + 1,
            )
            deferred.extend(to_ingest[i - 1:])
            break

        zip_path: Optional[str] = None

        try:
            t0 = time.time()

            # Download XBRL ZIP from FFIEC CDR API
            zip_path = download_quarter_from_ffiec(quarter_date)

            # Parse all institution XMLs into a flat list of dicts
            records = parse_xbrl_zip_to_records(zip_path, quarter_date)

            # Initialize SparkSession once — reuse across all quarters in this run
            if spark is None:
                logger.info("Initializing SparkSession ...")
                spark = get_spark_session(quarter_date)
                spark.sparkContext.setLogLevel("WARN")

            # Build Spark DataFrame and write directly to R2 via S3A
            estimated_bytes = process_and_upload_with_spark(records, quarter_date, spark)
            bytes_written  += estimated_bytes
            elapsed         = time.time() - t0

            succeeded.append(quarter_date)
            logger.info(
                "Done in %.1fs | estimated write: %.1f MB | total written: %.3f GB",
                elapsed, estimated_bytes / 1024 ** 2, bytes_written / 1024 ** 3,
            )

        except Exception as exc:
            logger.error(
                "Failed to process %s: %s",
                quarter_date, exc, exc_info=True,
            )
            failed.append(quarter_date)
            # Continue to next quarter — one failure should not abort the run

        finally:
            # Always clean up the downloaded ZIP regardless of success or failure
            if zip_path and os.path.exists(zip_path):
                try:
                    os.remove(zip_path)
                    logger.debug("Cleaned up ZIP: %s", zip_path)
                except OSError as exc:
                    logger.warning("Could not remove ZIP %s: %s", zip_path, exc)

    # Stop Spark after all quarters are processed
    if spark is not None:
        spark.stop()
        logger.info("SparkSession stopped.")

    total_elapsed = time.time() - run_start

    # Step 9 — Write updated run metadata back to R2
    updated_r2 = list_r2_quarters(s3)
    write_metadata(s3, {
        "last_run_utc"             : datetime.now(timezone.utc).isoformat(),
        "last_run_mode"            : "full_history" if full_history else "incremental",
        "last_run_engine"          : "pyspark",
        "last_run_succeeded"       : succeeded,
        "last_run_failed"          : failed,
        "last_run_deferred"        : deferred,
        "last_run_bytes_written"   : bytes_written,
        "last_run_duration_seconds": round(total_elapsed),
        "total_quarters_in_r2"     : len(updated_r2),
        "total_gb_stored"          : sum(updated_r2.values()) / 1024 ** 3,
        "last_run_result"          : "completed" if not failed else "completed_with_errors",
    })

    logger.info("=" * 70)
    logger.info("SUMMARY")
    logger.info(
        "  Succeeded : %d  %s%s",
        len(succeeded),
        succeeded[:3],
        "..." if len(succeeded) > 3 else "",
    )
    logger.info("  Failed    : %d  %s", len(failed), failed or "")
    logger.info("  Deferred  : %d  (budget limit)", len(deferred))
    logger.info("  Written   : %.3f GB (estimated)", bytes_written / 1024 ** 3)
    logger.info("  Duration  : %.1f minutes", total_elapsed / 60)
    logger.info(
        "  R2 total  : %d quarters, %.2f GB",
        len(updated_r2),
        sum(updated_r2.values()) / 1024 ** 3,
    )
    if deferred:
        logger.info(
            "  Next run  : will pick up %s through %s",
            deferred[0], deferred[-1],
        )
    logger.info("=" * 70)


# CLI entry point

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="UBPR ingestion pipeline — syncs FFIEC data to Cloudflare R2 using PySpark"
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Full history backfill — ingest all missing quarters from 2001 onward.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show the ingestion plan without downloading or uploading anything.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Skip the delta check and force a run regardless of R2 state.",
    )
    parser.add_argument(
        "--budget-gb",
        type=float,
        default=None,
        help=f"Override the per-run write budget in GB (default: {BUDGET_GB}).",
    )
    args = parser.parse_args()

    if args.budget_gb is not None:
        BUDGET_GB    = args.budget_gb
        BUDGET_BYTES = BUDGET_GB * 1024 ** 3
        logger.info("Budget overridden to %.1f GB", BUDGET_GB)

    run(
        full_history=args.full,
        dry_run=args.dry_run,
        force=args.force,
    )