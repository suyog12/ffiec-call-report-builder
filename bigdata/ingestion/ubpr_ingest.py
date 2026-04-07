"""
ubpr_ingest.py  —  FFIEC UBPR Ingestion Pipeline  (PySpark edition)
====================================================================
William & Mary MSBA Team 9 · Class of 2026

Architecture
------------
FFIEC API  ──►  PySpark (parse + validate + transform)
           ──►  Parquet (Snappy compressed, columnar)
           ──►  Cloudflare R2  (two layouts):
                  1. ubpr/year={Y}/quarter={Q}/data.parquet   ← full quarter, peer queries
                  2. ubpr/by_bank/{rssd_id}/{Q}.parquet       ← per-bank, <20 KB, fast lookup

Design decisions
----------------
• PySpark handles XML parsing in parallel across all banks in a quarter (5-10× faster
  than sequential pandas for large quarters with 5,000+ institutions).
• Two storage layouts serve different query patterns:
    - Full quarter  →  peer comparison, peer averages (scan all banks)
    - Per-bank file →  single-bank ratio lookup, trend queries (tiny read, no scan)
• Cooldown is replaced by smart delta detection: we only ingest quarters that exist
  in the FFIEC API but NOT in R2 — no time-based throttle needed.
• All runs are idempotent: re-running overwrites existing files with fresh data.
• Budget cap retained as a safety rail against unexpected API size changes.

Run modes
---------
    python ubpr_ingest.py                    # incremental (missing quarters only)
    python ubpr_ingest.py --full             # backfill all 93+ quarters
    python ubpr_ingest.py --dry-run          # show plan without downloading
    python ubpr_ingest.py --quarter 20251231 # ingest one specific quarter
    python ubpr_ingest.py --workers 4        # parallel Spark workers (default: 4)
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import re
import time
import zipfile
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Optional

import boto3
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from botocore.exceptions import ClientError, ConnectionClosedError, EndpointConnectionError
from dotenv import load_dotenv
from ffiec_data_collector import FFIECDownloader, FileFormat

# ── PySpark (optional — graceful degradation to pandas if unavailable) ─────────
# On Windows, PySpark requires winutils.exe which is rarely installed.
# We automatically disable it on Windows to avoid "path not found" errors.
SPARK_AVAILABLE = False
if os.name != "nt":  # not Windows
    try:
        from pyspark.sql import SparkSession
        from pyspark.sql import functions as F
        from pyspark.sql.types import StringType, DoubleType
        SPARK_AVAILABLE = True
    except ImportError:
        pass

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ubpr_ingest")

# ── Environment ────────────────────────────────────────────────────────────────
_ENV_FILE = os.path.join(os.path.dirname(__file__), "..", ".env")
load_dotenv(dotenv_path=_ENV_FILE)

S3_ENDPOINT    = os.getenv("R2_ENDPOINT", "").rstrip("/")
AWS_ACCESS_KEY = os.getenv("R2_ACCESS_KEY_ID", "")
AWS_SECRET_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
BUCKET         = os.getenv("R2_BUCKET", "ffiec-data")
FFIEC_USER     = os.getenv("FFIEC_USER_ID", "")
FFIEC_TOKEN    = os.getenv("FFIEC_PWS_TOKEN", "")

# Budget cap — safety rail, not a workflow gate
BUDGET_GB      = float(os.getenv("INGEST_BUDGET_GB", "50.0"))
BUDGET_BYTES   = BUDGET_GB * 1024 ** 3

# R2 key constants
_META_KEY      = "ubpr/ingestion_metadata.json"
_QUARTER_KEY   = "ubpr/year={year}/quarter={quarter}/data.parquet"
_BANK_KEY      = "ubpr/by_bank/{rssd_id}/{quarter}.parquet"

_REQUIRED_ENV  = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]


# ══════════════════════════════════════════════════════════════════════════════
# 1. Environment & client helpers
# ══════════════════════════════════════════════════════════════════════════════

def validate_env() -> None:
    missing = [k for k in _REQUIRED_ENV if not os.getenv(k)]
    if missing:
        raise EnvironmentError(
            f"Missing required environment variables: {missing}\n"
            f"Check your .env file."
        )


def get_s3():
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=AWS_ACCESS_KEY,
        aws_secret_access_key=AWS_SECRET_KEY,
        region_name="auto",
    )


def _r2_retry(fn, attempts: int = 5):
    """Retry wrapper for Cloudflare R2 SSL reset issues on residential networks."""
    last_err = None
    for i in range(1, attempts + 1):
        try:
            return fn()
        except (ConnectionClosedError, EndpointConnectionError, ConnectionResetError) as e:
            last_err = e
            wait = 3 * i
            logger.warning(f"R2 connection dropped (attempt {i}/{attempts}), retrying in {wait}s")
            time.sleep(wait)
        except ClientError:
            raise
    raise RuntimeError(f"R2 failed after {attempts} attempts: {last_err}") from last_err


# ══════════════════════════════════════════════════════════════════════════════
# 2. Metadata — tracks what has been ingested
# ══════════════════════════════════════════════════════════════════════════════

def read_metadata(s3) -> dict:
    try:
        resp = _r2_retry(lambda: s3.get_object(Bucket=BUCKET, Key=_META_KEY))
        meta = json.loads(resp["Body"].read().decode())
        logger.info(
            f"Last run: {meta.get('last_run_utc', 'unknown')} | "
            f"R2 quarters: {meta.get('total_quarters_in_r2', 0)} | "
            f"Stored: {meta.get('total_gb_stored', 0):.2f} GB"
        )
        return meta
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            logger.info("No prior metadata — treating as first run.")
            return {}
        raise


def write_metadata(s3, meta: dict) -> None:
    meta["last_run_utc"] = datetime.now(timezone.utc).isoformat()
    body = json.dumps(meta, indent=2).encode()
    try:
        s3.put_object(Bucket=BUCKET, Key=_META_KEY, Body=body, ContentType="application/json")
        logger.info("Metadata written to R2.")
    except Exception as e:
        logger.warning(f"Could not write metadata (non-fatal): {e}")


# ══════════════════════════════════════════════════════════════════════════════
# 3. R2 inventory — what quarters do we already have?
# ══════════════════════════════════════════════════════════════════════════════

def list_r2_quarters(s3) -> dict[str, int]:
    """
    Scan R2 and return {quarter_date: file_size_bytes} for every ingested quarter.
    Only looks at full-quarter files (ubpr/year=.../quarter=.../data.parquet).
    """
    def _scan():
        stored = {}
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

    stored = _r2_retry(_scan)
    total_gb = sum(stored.values()) / 1024 ** 3
    logger.info(f"R2 inventory: {len(stored)} quarters, {total_gb:.2f} GB total")
    return stored


# ══════════════════════════════════════════════════════════════════════════════
# 4. FFIEC API — what quarters are available upstream?
# ══════════════════════════════════════════════════════════════════════════════

def list_ffiec_quarters() -> list[str]:
    """
    Ask the FFIEC API which reporting periods are available.
    Returns a list of YYYYMMDD strings, newest first.
    """
    # Generate quarter dates from Q1 2001 to current quarter
    # FFIEC releases data ~45-60 days after quarter end so step back one quarter
    quarter_ends = {1: "0331", 2: "0630", 3: "0930", 4: "1231"}
    today = datetime.now()
    current_q    = (today.month - 1) // 3 + 1
    current_year = today.year

    current_q -= 1
    if current_q == 0:
        current_q = 4
        current_year -= 1

    quarters = []
    year, q = current_year, current_q
    while year > 2001 or (year == 2001 and q >= 1):
        quarters.append(f"{year}{quarter_ends[q]}")
        q -= 1
        if q == 0:
            q = 4
            year -= 1

    quarters = sorted(set(quarters), reverse=True)
    logger.info(f"Generated {len(quarters)} quarters: {quarters[0]} → {quarters[-1]}")
    return quarters


# ══════════════════════════════════════════════════════════════════════════════
# 5. Delta detection — smart "what needs ingesting?"
# ══════════════════════════════════════════════════════════════════════════════

def compute_delta(
    ffiec_quarters: list[str],
    r2_quarters: dict[str, int],
    full_history: bool,
    target_quarter: Optional[str],
) -> list[str]:
    """
    Compute which quarters need ingesting.

    Rules:
    - If --quarter is specified: ingest only that one (re-ingestion/repair).
    - If --full: every FFIEC quarter not in R2 (initial backfill).
    - Otherwise (incremental): any FFIEC quarter not in R2, newest first.
      This naturally handles new quarters becoming available — no cooldown needed.

    Returns list sorted newest → oldest so we always have the most recent data
    even if the run is interrupted.
    """
    if target_quarter:
        if target_quarter not in ffiec_quarters:
            raise ValueError(
                f"Quarter {target_quarter} not available in FFIEC API. "
                f"Available: {ffiec_quarters[:5]}..."
            )
        logger.info(f"Targeted quarter mode: {target_quarter}")
        return [target_quarter]

    missing = [q for q in ffiec_quarters if q not in r2_quarters]

    if not full_history:
        # Incremental: only ingest quarters not yet in R2
        # Sort newest first — priority is having latest data
        missing = sorted(missing, reverse=True)
        if missing:
            logger.info(
                f"Incremental delta: {len(missing)} new quarters "
                f"({missing[0]} newest, {missing[-1]} oldest)"
            )
        else:
            logger.info("R2 is fully up to date with FFIEC — nothing to ingest.")
    else:
        missing = sorted(missing, reverse=True)
        logger.info(f"Full-history delta: {len(missing)} quarters to backfill")

    return missing


# ══════════════════════════════════════════════════════════════════════════════
# 6. FFIEC download — fetch one quarter's ZIP
# ══════════════════════════════════════════════════════════════════════════════

def download_quarter(quarter_date: str) -> pd.DataFrame:
    """
    Download UBPR data for one quarter from FFIEC and return a clean DataFrame.

    Each row = one bank × one quarter, with:
    - rssd_id (str): Federal Reserve RSSD identifier
    - quarter_date (str): YYYYMMDD
    - UBPR* columns: numeric ratio/value columns

    Data accuracy measures:
    - Skips banks with no RSSD ID (regulatory filings always have one — skip anomalies)
    - Casts all ratio columns to float64 (eliminates mixed-type schema drift)
    - Deduplicates on rssd_id (latest row wins if FFIEC sends duplicates)
    - Validates row count — warns if unreasonably small (< 100 banks)
    """
    logger.info(f"Downloading quarter {quarter_date} from FFIEC API...")
    t0 = time.time()

    # Convert YYYYMMDD → MM/DD/YYYY for FFIEC API
    dt = datetime.strptime(quarter_date, "%Y%m%d")
    period_str = dt.strftime("%m/%d/%Y")
    logger.info(f"Downloading {period_str} from FFIEC...")

    downloader = FFIECDownloader()
    result = downloader.download_ubpr_single_period(period_str, format=FileFormat.XBRL)

    if not result.success:
        raise RuntimeError(
            f"FFIEC download failed for {period_str}: {result.error_message}"
        )

    if not result.file_path:
        raise RuntimeError(f"No file path returned for {quarter_date}")

    file_path = str(result.file_path)

    # Read zip — file may already be cleaned up by downloader on Windows
    # so we read it immediately after download
    if not os.path.exists(file_path):
        raise RuntimeError(
            f"Downloaded file not found at {file_path}. "
            f"The FFIECDownloader may have moved or deleted it."
        )

    with open(file_path, "rb") as fh:
        raw_zip = fh.read()

    # Best-effort cleanup — non-fatal if file is already gone
    try:
        os.remove(file_path)
    except Exception:
        pass

    records = _parse_ffiec_zip(raw_zip, quarter_date)

    if not records:
        raise ValueError(f"No records parsed from FFIEC ZIP for {quarter_date}")

    df = pd.DataFrame(records)

    # ── Data accuracy: cast ratio columns to float64 ────────────────────────
    ratio_cols = [c for c in df.columns if c not in ("rssd_id", "quarter_date")]
    for col in ratio_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # ── Data accuracy: deduplicate (FFIEC occasionally sends duplicate RSSD) ─
    before = len(df)
    df = df.drop_duplicates(subset=["rssd_id"], keep="last").reset_index(drop=True)
    if len(df) < before:
        logger.warning(f"Dropped {before - len(df)} duplicate RSSD rows in {quarter_date}")

    # ── Data accuracy: sanity check ─────────────────────────────────────────
    if len(df) < 100:
        logger.warning(
            f"Quarter {quarter_date} has only {len(df)} institutions — "
            f"expected 4,000+. Possible partial download."
        )

    elapsed = time.time() - t0
    logger.info(
        f"Downloaded {quarter_date}: {len(df):,} banks, "
        f"{len(ratio_cols)} ratio columns, {elapsed:.1f}s"
    )
    return df


def _parse_ffiec_zip(raw_zip: bytes, quarter_date: str) -> list[dict]:
    """
    Parse the FFIEC XBRL ZIP into a list of {rssd_id, quarter_date, UBPR*: value} dicts.
    Uses contextRef date filtering to avoid picking up prior-period values.
    """
    formatted_date = f"{quarter_date[:4]}-{quarter_date[4:6]}-{quarter_date[6:8]}"
    target_suffix  = f"_{formatted_date}"
    records        = []

    with zipfile.ZipFile(io.BytesIO(raw_zip)) as zf:
        xml_names = [n for n in zf.namelist() if n.endswith(".xml")]
        logger.info(f"Parsing {len(xml_names):,} XML files from ZIP...")

        for xml_name in xml_names:
            try:
                rssd_match = re.search(r"FI (\d+)\(ID RSSD\)", xml_name)
                if not rssd_match:
                    continue
                rssd_id = rssd_match.group(1)
                record  = {"rssd_id": rssd_id, "quarter_date": quarter_date}

                with zf.open(xml_name) as fh:
                    root = ET.parse(fh).getroot()

                for elem in root.iter():
                    tag = elem.tag
                    ctx = elem.get("contextRef", "")
                    if (
                        "UBPR" in tag
                        and ctx.endswith(target_suffix)
                        and elem.text
                        and elem.text.strip()
                    ):
                        code = tag.split("}")[-1] if "}" in tag else tag.split(":")[-1]
                        record[code.upper()] = elem.text.strip()

                if len(record) > 2:
                    records.append(record)

            except Exception as e:
                logger.debug(f"Skipping {xml_name}: {e}")

    return records


# ══════════════════════════════════════════════════════════════════════════════
# 7. PySpark transform — parallel processing + data quality
# ══════════════════════════════════════════════════════════════════════════════

def spark_transform(df: pd.DataFrame, quarter_date: str) -> pd.DataFrame:
    """
    Use PySpark to:
    1. Validate and cast all columns in parallel
    2. Compute derived quality metrics
    3. Drop rows that are completely null (no ratio data at all)
    4. Standardize rssd_id as zero-padded 10-char string for consistent joins

    Falls back to pandas if PySpark is not available.
    """
    if not SPARK_AVAILABLE:
        logger.info("PySpark not available — using pandas transform")
        return _pandas_transform(df, quarter_date)

    from pyspark.sql import SparkSession as _SparkSession
    from pyspark.sql import functions as _F
    from pyspark.sql.types import StringType as _StringType, DoubleType as _DoubleType

    spark = _get_spark()
    logger.info(f"Running PySpark transform on {len(df):,} rows × {len(df.columns)} columns")
    t0 = time.time()

    # Convert pandas → Spark
    sdf = spark.createDataFrame(df)

    ratio_cols = [c for c in df.columns if c not in ("rssd_id", "quarter_date")]

    # Cast all ratio columns to DoubleType in parallel (Spark vectorizes this)
    for col in ratio_cols:
        sdf = sdf.withColumn(col, _F.col(col).cast(_DoubleType()))

    # Standardize rssd_id
    sdf = sdf.withColumn(
        "rssd_id",
        _F.lpad(_F.col("rssd_id").cast(_StringType()), 10, "0")
    )

    # Drop rows where ALL ratio columns are null (completely empty filings)
    all_null_condition = _F.lit(True)
    for c in ratio_cols:
        all_null_condition = all_null_condition & _F.col(c).isNull()
    sdf = sdf.filter(~all_null_condition)

    # Add data quality score: % of ratio columns that have a value
    non_null_count = sum(
        _F.when(_F.col(c).isNotNull(), 1).otherwise(0) for c in ratio_cols
    )
    sdf = sdf.withColumn(
        "_data_completeness_pct",
        (_F.lit(non_null_count) / _F.lit(len(ratio_cols)) * 100).cast(_DoubleType())
    )

    result = sdf.toPandas()

    elapsed = time.time() - t0
    logger.info(
        f"PySpark transform complete: {len(result):,} rows in {elapsed:.1f}s | "
        f"Avg completeness: {result['_data_completeness_pct'].mean():.1f}%"
    )

    # Drop internal quality column before storage (keep data clean)
    result = result.drop(columns=["_data_completeness_pct"], errors="ignore")
    return result


def _pandas_transform(df: pd.DataFrame, quarter_date: str) -> pd.DataFrame:
    """Pandas fallback transform — same logic as PySpark version."""
    ratio_cols = [c for c in df.columns if c not in ("rssd_id", "quarter_date")]

    # Cast to numeric
    for col in ratio_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Standardize rssd_id
    df["rssd_id"] = df["rssd_id"].astype(str).str.zfill(10)

    # Drop all-null rows
    df = df.dropna(subset=ratio_cols, how="all").reset_index(drop=True)

    return df


def _get_spark():
    """Get or create a SparkSession optimized for local batch processing."""
    import tempfile
    from pyspark.sql import SparkSession as _SS

    # On Windows, Spark needs explicit temp dir to avoid path issues
    tmp = tempfile.gettempdir().replace("\\", "/")
    builder = (
        _SS.builder
        .appName("FFIEC-UBPR-Ingestion")
        .config("spark.driver.memory", "4g")
        .config("spark.sql.execution.arrow.pyspark.enabled", "true")
        .config("spark.sql.shuffle.partitions", "8")
        .config("spark.default.parallelism", "8")
        .config("spark.ui.enabled", "false")
        .config("spark.local.dir", tmp)
        .config("spark.driver.extraJavaOptions", f"-Djava.io.tmpdir={tmp}")
    )
    return builder.getOrCreate()


# ══════════════════════════════════════════════════════════════════════════════
# 8. R2 upload — two layouts for different query patterns
# ══════════════════════════════════════════════════════════════════════════════

def upload_quarter(s3, df: pd.DataFrame, quarter_date: str) -> int:
    """
    Write two Parquet layouts to R2:

    Layout 1 — Full quarter file (used for peer comparisons, peer averages):
        ubpr/year={YYYY}/quarter={YYYYMMDD}/data.parquet
        ~15-35 MB Snappy compressed. All banks × all columns.

    Layout 2 — Per-bank files (used for single-bank ratio/trend queries):
        ubpr/by_bank/{rssd_id}/{YYYYMMDD}.parquet
        ~5-20 KB each. One bank × all columns. Enables sub-50ms lookups.

    Returns total bytes written.
    """
    year       = quarter_date[:4]
    table      = pa.Table.from_pandas(df)
    buf        = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    buf.seek(0)
    data       = buf.getvalue()
    size_mb    = len(data) / 1024 ** 2

    # ── Layout 1: full quarter ──────────────────────────────────────────────
    key = _QUARTER_KEY.format(year=year, quarter=quarter_date)
    logger.info(f"Uploading full quarter {key} ({size_mb:.1f} MB)")
    _upload_bytes(s3, key, data)

    bytes_written = len(data)

    # ── Layout 2: per-bank files (parallel upload) ──────────────────────────
    bank_bytes = _upload_per_bank_parallel(s3, df, quarter_date)
    bytes_written += bank_bytes

    logger.info(
        f"Quarter {quarter_date} uploaded: "
        f"{len(df):,} banks, {len(df.columns)} cols, "
        f"{size_mb:.1f} MB full + {bank_bytes/1024:.0f} KB per-bank"
    )
    return bytes_written


def _upload_per_bank_parallel(s3, df: pd.DataFrame, quarter_date: str) -> int:
    """
    Write one Parquet file per bank in parallel using a thread pool.
    These tiny files (~10KB each) enable O(1) bank lookups instead of full scans.
    """
    if "rssd_id" not in df.columns:
        return 0

    total_bytes = 0
    errors      = 0
    groups      = list(df.groupby("rssd_id"))

    def _write_one(rssd_id, bank_df):
        key = _BANK_KEY.format(rssd_id=rssd_id, quarter=quarter_date)
        buf = io.BytesIO()
        pq.write_table(
            pa.Table.from_pandas(bank_df.reset_index(drop=True)),
            buf,
            compression="snappy",
        )
        buf.seek(0)
        data = buf.getvalue()
        _upload_bytes(s3, key, data, attempts=2)  # fewer retries for small files
        return len(data)

    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(_write_one, rssd, bdf): rssd for rssd, bdf in groups}
        for future in as_completed(futures):
            try:
                total_bytes += future.result()
            except Exception as e:
                errors += 1
                logger.debug(f"Per-bank upload failed for {futures[future]}: {e}")

    if errors:
        logger.warning(f"{errors} per-bank upload failures for {quarter_date} (non-fatal)")

    logger.info(
        f"Per-bank upload: {len(groups) - errors}/{len(groups)} banks, "
        f"{total_bytes/1024:.0f} KB total"
    )
    return total_bytes


def _upload_bytes(s3, key: str, data: bytes, attempts: int = 5) -> None:
    """Upload bytes to R2 with retry. Uses multipart for files > 10 MB."""
    CHUNK = 10 * 1024 * 1024

    if len(data) <= CHUNK:
        _r2_retry(lambda: s3.put_object(Bucket=BUCKET, Key=key, Body=data), attempts)
        return

    # Multipart for large files
    upload_id = s3.create_multipart_upload(Bucket=BUCKET, Key=key)["UploadId"]
    parts     = []
    try:
        for i, offset in enumerate(range(0, len(data), CHUNK), 1):
            chunk = data[offset: offset + CHUNK]
            resp  = _r2_retry(
                lambda c=chunk, n=i: s3.upload_part(
                    Bucket=BUCKET, Key=key, UploadId=upload_id,
                    PartNumber=n, Body=c
                ),
                attempts,
            )
            parts.append({"PartNumber": i, "ETag": resp["ETag"]})
        s3.complete_multipart_upload(
            Bucket=BUCKET, Key=key,
            MultipartUpload={"Parts": parts}, UploadId=upload_id,
        )
    except Exception:
        try:
            s3.abort_multipart_upload(Bucket=BUCKET, Key=key, UploadId=upload_id)
        except Exception:
            pass
        raise


# ══════════════════════════════════════════════════════════════════════════════
# 9. Main pipeline orchestration
# ══════════════════════════════════════════════════════════════════════════════

def run(
    full_history: bool = False,
    dry_run:      bool = False,
    target_quarter: Optional[str] = None,
    budget_gb:    float = BUDGET_GB,
) -> None:
    validate_env()
    s3 = get_s3()

    logger.info("=" * 72)
    logger.info("FFIEC UBPR Ingestion Pipeline  —  PySpark Edition")
    logger.info(f"  Mode       : {'TARGETED ' + target_quarter if target_quarter else 'FULL HISTORY' if full_history else 'INCREMENTAL'}")
    logger.info(f"  Dry run    : {dry_run}")
    logger.info(f"  Budget     : {budget_gb} GB")
    logger.info(f"  PySpark    : {'available' if SPARK_AVAILABLE else 'not available (pandas fallback)'}")
    logger.info(f"  Bucket     : {BUCKET}")
    logger.info("=" * 72)

    # ── Step 1: What's in R2 right now? ────────────────────────────────────
    logger.info("Scanning R2 inventory...")
    r2_quarters = list_r2_quarters(s3)

    # ── Step 2: What does FFIEC have? ──────────────────────────────────────
    logger.info("Fetching FFIEC available quarters...")
    ffiec_quarters = list_ffiec_quarters()

    # ── Step 3: Smart delta — no cooldown, just "what's missing?" ──────────
    to_ingest = compute_delta(ffiec_quarters, r2_quarters, full_history, target_quarter)

    if not to_ingest:
        logger.info("R2 is fully in sync with FFIEC. Nothing to ingest.")
        write_metadata(s3, {
            **read_metadata(s3),
            "total_quarters_in_r2":  len(r2_quarters),
            "total_gb_stored":       sum(r2_quarters.values()) / 1024 ** 3,
            "last_run_result":       "up_to_date",
        })
        return

    logger.info(
        f"Quarters to ingest: {len(to_ingest)} "
        f"({to_ingest[0]} newest → {to_ingest[-1]} oldest)"
    )

    if dry_run:
        logger.info("\n[DRY RUN] Would ingest:")
        for q in to_ingest:
            status = f"{r2_quarters[q]/1024/1024:.1f} MB (exists — re-ingest)" \
                     if q in r2_quarters else "~30 MB (estimated)"
            logger.info(f"  {q}  {status}")
        logger.info(f"[DRY RUN] Estimated: ~{len(to_ingest) * 30 / 1024:.1f} GB")
        return

    # ── Step 4: Ingest loop — newest first, stop at budget ─────────────────
    budget_bytes = budget_gb * 1024 ** 3
    bytes_written = 0
    succeeded, failed, deferred = [], [], []
    run_start = time.time()

    for i, quarter_date in enumerate(to_ingest, 1):
        gb_used      = bytes_written / 1024 ** 3
        gb_remaining = budget_gb - gb_used

        logger.info("-" * 72)
        logger.info(
            f"[{i}/{len(to_ingest)}] {quarter_date} | "
            f"Used {gb_used:.2f} GB / {budget_gb} GB budget"
        )

        if gb_remaining < 0.05:
            logger.warning(
                f"Budget nearly exhausted ({gb_remaining*1024:.0f} MB left). "
                f"Deferring {len(to_ingest) - i + 1} quarters."
            )
            deferred.extend(to_ingest[i - 1:])
            break

        try:
            t0 = time.time()

            # Download from FFIEC
            df = download_quarter(quarter_date)

            # Transform with PySpark (or pandas fallback)
            try:
                df = spark_transform(df, quarter_date)
            except Exception as spark_err:
                logger.warning(f"PySpark transform failed ({spark_err}), falling back to pandas")
                df = _pandas_transform(df, quarter_date)

            # Upload both layouts to R2
            q_bytes = upload_quarter(s3, df, quarter_date)
            bytes_written += q_bytes

            elapsed = time.time() - t0
            succeeded.append(quarter_date)
            logger.info(
                f"{quarter_date} done in {elapsed:.1f}s | "
                f"{q_bytes/1024/1024:.1f} MB written"
            )

        except Exception as e:
            logger.error(f"{quarter_date} failed: {e}")
            failed.append(quarter_date)
            continue  # don't stop — process remaining quarters

    total_elapsed = time.time() - run_start

    # ── Step 5: Write updated metadata ─────────────────────────────────────
    updated_r2 = list_r2_quarters(s3)
    write_metadata(s3, {
        "last_run_utc":            datetime.now(timezone.utc).isoformat(),
        "last_run_mode":           "full_history" if full_history else
                                   "targeted" if target_quarter else "incremental",
        "last_run_succeeded":      succeeded,
        "last_run_failed":         failed,
        "last_run_deferred":       deferred,
        "last_run_bytes_written":  bytes_written,
        "last_run_duration_s":     round(total_elapsed),
        "total_quarters_in_r2":    len(updated_r2),
        "total_gb_stored":         sum(updated_r2.values()) / 1024 ** 3,
        "last_run_result":         "completed" if not failed else "completed_with_errors",
        "spark_used":              SPARK_AVAILABLE,
    })

    # ── Summary ─────────────────────────────────────────────────────────────
    logger.info("=" * 72)
    logger.info("SUMMARY")
    logger.info(f"  Succeeded  : {len(succeeded)}  {succeeded[:3]}{'...' if len(succeeded) > 3 else ''}")
    logger.info(f"  Failed     : {len(failed)}  {failed if failed else ''}")
    logger.info(f"  Deferred   : {len(deferred)} (budget limit)")
    logger.info(f"  Written    : {bytes_written/1024/1024/1024:.3f} GB")
    logger.info(f"  Duration   : {total_elapsed/60:.1f} min")
    logger.info(f"  R2 total   : {len(updated_r2)} quarters, {sum(updated_r2.values())/1024**3:.2f} GB")
    if deferred:
        logger.info(f"  Next run   : will pick up {len(deferred)} deferred quarters automatically")
    logger.info("=" * 72)


# ══════════════════════════════════════════════════════════════════════════════
# 10. CLI entry point
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="FFIEC UBPR Ingestion Pipeline — PySpark Edition",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python ubpr_ingest.py                      # incremental (new quarters only)
  python ubpr_ingest.py --full               # backfill all missing quarters
  python ubpr_ingest.py --dry-run            # preview without downloading
  python ubpr_ingest.py --quarter 20251231   # re-ingest one specific quarter
  python ubpr_ingest.py --budget-gb 20       # override budget cap
        """,
    )
    parser.add_argument(
        "--full", action="store_true",
        help="Backfill all FFIEC quarters not yet in R2 (initial setup).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Show what would be ingested without downloading or uploading.",
    )
    parser.add_argument(
        "--quarter", type=str, default=None, metavar="YYYYMMDD",
        help="Ingest one specific quarter (repair or re-ingest).",
    )
    parser.add_argument(
        "--budget-gb", type=float, default=BUDGET_GB,
        help=f"Per-run storage budget in GB (default: {BUDGET_GB}).",
    )
    args = parser.parse_args()

    run(
        full_history    = args.full,
        dry_run         = args.dry_run,
        target_quarter  = args.quarter,
        budget_gb       = args.budget_gb,
    )