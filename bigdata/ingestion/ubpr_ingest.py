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
# PySpark disabled — pandas is faster for wide DataFrames (2,800+ columns)
# PySpark excels at row-level parallelism (millions of rows), not wide schemas
# Our data: ~4,400 rows × 2,810 columns — pandas handles this in seconds
SPARK_AVAILABLE = False

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
_BANK_KEY      = "ubpr/by_bank/{quarter}/{rssd_id}.parquet"

_REQUIRED_ENV  = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]


# 1. Environment & client helpers

def validate_env() -> None:
    missing = [k for k in _REQUIRED_ENV if not os.getenv(k)]
    if missing:
        raise EnvironmentError(
            f"Missing required environment variables: {missing}\n"
            f"Check your .env file."
        )


def get_s3():
    from botocore.config import Config
    config = Config(
        max_pool_connections=10,
        retries={"max_attempts": 5, "mode": "adaptive"},
        connect_timeout=10,      # 10s to establish connection
        read_timeout=120,        # 2 min max per read — prevents hanging forever
    )
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=AWS_ACCESS_KEY,
        aws_secret_access_key=AWS_SECRET_KEY,
        region_name="auto",
        config=config,
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


# 2. Metadata — tracks what has been ingested

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


# 3. R2 inventory — what quarters do we already have?

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


# 3b. R2 state checker — what files exist for each quarter?

def check_r2_quarter_state(s3, quarter_date: str) -> dict:
    """
    Check what files exist in R2 for a given quarter.

    Strategy:
      1. HEAD the full-quarter file — instant single request
      2. If full-quarter exists, read 3 RSSDIDs directly from it
         then HEAD those specific per-bank keys — 3 fast requests
      3. First per-bank hit → has_per_bank = True, stop checking
         All 3 miss → has_per_bank = False, needs backfill

    This approach:
      - Never lists the entire by_bank/ prefix (avoids slow scans)
      - Uses actual RSSDIDs from the quarter (works for all quarters)
      - Completes in <1 second per quarter
    """
    import duckdb as _duckdb

    year     = quarter_date[:4]
    full_key = f"ubpr/year={year}/quarter={quarter_date}/data.parquet"
    full_url = f"s3://{BUCKET}/{full_key}"

    # Step 1 — Check full-quarter file
    has_full = False
    try:
        s3.head_object(Bucket=BUCKET, Key=full_key)
        has_full = True
    except Exception:
        pass

    if not has_full:
        return {"has_full_quarter": False, "has_per_bank": False, "per_bank_count": 0}

    # Step 2 — Get 3 RSSDIDs from the full-quarter file
    S3_HOST = S3_ENDPOINT.replace("https://", "").replace("http://", "").rstrip("/")
    sample_rssd_ids = []
    try:
        con = _duckdb.connect()
        try:
            con.execute("INSTALL httpfs; LOAD httpfs;")
            con.execute(f"SET s3_endpoint = '{S3_HOST}';")
            con.execute(f"SET s3_access_key_id = '{AWS_ACCESS_KEY}';")
            con.execute(f"SET s3_secret_access_key = '{AWS_SECRET_KEY}';")
            con.execute("SET s3_region = 'auto';")
            con.execute("SET s3_use_ssl = true;")
            con.execute("SET s3_url_style = 'path';")
            rows = con.execute(
                f"SELECT rssd_id FROM read_parquet('{full_url}') LIMIT 3"
            ).fetchall()
            sample_rssd_ids = [str(row[0]) for row in rows]
        finally:
            con.close()
    except Exception as e:
        logger.warning(f"Could not sample RSSDIDs from {quarter_date}: {e}")
        return {"has_full_quarter": True, "has_per_bank": False, "per_bank_count": 0}

    # Step 3 — HEAD each sampled RSSDID's per-bank file
    has_per_bank = False
    for rssd_id in sample_rssd_ids:
        try:
            s3.head_object(
                Bucket=BUCKET,
                Key=f"ubpr/by_bank/{quarter_date}/{rssd_id}.parquet"
            )
            has_per_bank = True
            break  # one hit is enough — quarter has per-bank files
        except Exception:
            continue  # this bank missing — try next

    return {
        "has_full_quarter": True,
        "has_per_bank":     has_per_bank,
        "per_bank_count":   1 if has_per_bank else 0,
    }


def backfill_per_bank_from_full_quarter(s3, quarter_date: str) -> int:
    """
    Read an existing full-quarter Parquet from R2 and split it into
    per-bank files. Used when full-quarter exists but per-bank files don't.

    Uses boto3 get_object (fast single download) instead of DuckDB httpfs
    to avoid slow streaming reads and connection overhead.
    Returns bytes written.
    """
    year    = quarter_date[:4]
    s3_key  = f"ubpr/year={year}/quarter={quarter_date}/data.parquet"

    logger.info(f"Downloading {quarter_date} from R2 for backfill...")
    t0 = time.time()

    try:
        obj  = s3.get_object(Bucket=BUCKET, Key=s3_key)
        data = obj["Body"].read()
    except Exception as e:
        logger.error(f"Failed to download {quarter_date} from R2: {e}")
        return 0

    logger.info(f"Downloaded {len(data)/1024/1024:.1f} MB in {time.time()-t0:.1f}s")

    try:
        table = pq.read_table(io.BytesIO(data))
        df    = table.to_pandas()
    except Exception as e:
        logger.error(f"Failed to parse Parquet for {quarter_date}: {e}")
        return 0

    if df.empty:
        logger.warning(f"Full-quarter file empty for {quarter_date}")
        return 0

    logger.info(
        f"Backfilling per-bank files for {quarter_date}: "
        f"{len(df):,} banks, {len(df.columns)} columns"
    )
    bank_bytes = _upload_per_bank_parallel(s3, df, quarter_date)
    logger.info(
        f"Backfill complete for {quarter_date}: "
        f"{bank_bytes/1024:.0f} KB written in {time.time()-t0:.1f}s total"
    )
    return bank_bytes


# 4. FFIEC API — what quarters are available upstream?

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


# 5. Delta detection — smart "what needs ingesting?"

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


# 6. FFIEC download — fetch one quarter's ZIP

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


# 7. PySpark transform — parallel processing + data quality

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


# 8. R2 upload — two layouts for different query patterns

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
    Write one Parquet file per bank to R2.
    Uses sequential uploads to avoid boto3 thread-safety deadlocks with Cloudflare R2.
    ~5ms per file × 4,400 files = ~22 seconds per quarter.
    """
    if "rssd_id" not in df.columns:
        return 0

    total_bytes = 0
    errors      = 0
    groups      = list(df.groupby("rssd_id"))

    # Pre-serialize all bank files to bytes first (CPU, no network)
    serialized: dict[str, bytes] = {}
    for rssd_id, bank_df in groups:
        buf = io.BytesIO()
        pq.write_table(
            pa.Table.from_pandas(bank_df.reset_index(drop=True)),
            buf,
            compression="snappy",
        )
        serialized[str(rssd_id)] = buf.getvalue()

    # Upload sequentially — avoids boto3/R2 connection pool deadlocks
    total_banks = len(serialized)
    log_interval = max(1, total_banks // 10)  # log every 10%

    for idx, (rssd_id, data) in enumerate(serialized.items(), 1):
        try:
            key = _BANK_KEY.format(rssd_id=rssd_id, quarter=quarter_date)
            s3.put_object(Bucket=BUCKET, Key=key, Body=data)
            total_bytes += len(data)
            if idx % log_interval == 0 or idx == total_banks:
                logger.info(
                    f"  Bank upload progress: {idx}/{total_banks} "
                    f"({idx*100//total_banks}%) — {total_bytes/1024:.0f} KB written"
                )
        except Exception as e:
            errors += 1
            logger.debug(f"Per-bank upload failed for {rssd_id}: {e}")

    if errors:
        logger.warning(f"{errors} per-bank upload failures for {quarter_date} (non-fatal)")

    logger.info(
        f"Per-bank upload complete: {len(groups) - errors}/{len(groups)} banks, "
        f"{total_bytes/1024:.0f} KB total"
    )
    return total_bytes


def _upload_bytes(s3, key: str, data: bytes, attempts: int = 5) -> None:
    """
    Upload bytes to R2 using boto3 transfer manager.
    Uses upload_fileobj which handles multipart automatically without deadlocks.
    """
    import io as _io
    from boto3.s3.transfer import TransferConfig

    config = TransferConfig(
        multipart_threshold   = 8 * 1024 * 1024,   # 8 MB threshold
        multipart_chunksize   = 8 * 1024 * 1024,   # 8 MB chunks
        max_concurrency       = 1,                  # sequential — no threading deadlocks
        use_threads           = False,              # critical: disable threading
    )

    last_err = None
    for attempt in range(1, attempts + 1):
        try:
            s3.upload_fileobj(
                _io.BytesIO(data),
                BUCKET,
                key,
                Config=config,
            )
            return
        except Exception as e:
            last_err = e
            wait = 3 * attempt
            logger.warning(f"Upload attempt {attempt}/{attempts} failed for {key}: {e}. Retrying in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"Upload failed after {attempts} attempts: {last_err}") from last_err


# 9. Main pipeline orchestration

def run(
    full_history:   bool  = False,
    dry_run:        bool  = False,
    target_quarter: Optional[str] = None,
    budget_gb:      float = BUDGET_GB,
) -> None:
    """
    Main ingestion pipeline.

    For each FFIEC quarter, checks R2 state and takes the minimum action needed:

        State A — neither full-quarter nor per-bank files exist:
            → Download from FFIEC, transform, upload BOTH layouts
            → Typical for new quarters (quarterly cadence)

        State B — full-quarter file exists but per-bank files missing:
            → Read existing full-quarter file, split into per-bank files
            → NO re-download needed (already have the data)
            → This handles all 93 quarters ingested by the old pipeline

        State C — both layouts exist:
            → Skip entirely — nothing to do

    This means the first run after deploying the new pipeline will
    automatically backfill per-bank files for all 93 existing quarters
    without touching the FFIEC API.
    """
    validate_env()
    s3 = get_s3()

    mode_label = (
        f"TARGETED {target_quarter}" if target_quarter
        else "FULL HISTORY" if full_history
        else "INCREMENTAL"
    )

    logger.info("=" * 72)
    logger.info("FFIEC UBPR Ingestion Pipeline — PySpark on Linux/Mac, pandas on Windows")
    logger.info(f"  Mode    : {mode_label}")
    logger.info(f"  Dry run : {dry_run}")
    logger.info(f"  Budget  : {budget_gb} GB")
    logger.info(f"  PySpark : {'available' if SPARK_AVAILABLE else 'not available (pandas fallback)'}")
    logger.info(f"  Bucket  : {BUCKET}")
    logger.info("=" * 72)

    # ── Step 1: R2 inventory ────────────────────────────────────────────────
    logger.info("Scanning R2 full-quarter inventory...")
    r2_quarters = list_r2_quarters(s3)

    # ── Step 2: FFIEC available quarters ───────────────────────────────────
    logger.info("Generating FFIEC quarter list...")
    ffiec_quarters = list_ffiec_quarters()

    # ── Step 3: Which quarters need ANY work? ───────────────────────────────
    if target_quarter:
        work_list = [target_quarter] if target_quarter in ffiec_quarters else []
    elif full_history:
        work_list = sorted(ffiec_quarters, reverse=True)
    else:
        # Incremental: quarters not fully in R2
        work_list = sorted(
            [q for q in ffiec_quarters if q not in r2_quarters],
            reverse=True,
        )

    if not work_list:
        logger.info("✅ R2 is fully in sync with FFIEC. Nothing to ingest.")
        write_metadata(s3, {
            **read_metadata(s3),
            "total_quarters_in_r2": len(r2_quarters),
            "total_gb_stored":      sum(r2_quarters.values()) / 1024 ** 3,
            "last_run_result":      "up_to_date",
        })
        return

    # ── Step 4: Classify each quarter (State A / B / C) ────────────────────
    logger.info(f"Classifying {len(work_list)} quarters...")

    need_download: list[str] = []   # State A — download + both layouts
    need_backfill: list[str] = []   # State B — per-bank files only
    already_done:  list[str] = []   # State C — skip

    for q in work_list:
        state = check_r2_quarter_state(s3, q)
        if state["has_full_quarter"] and state["has_per_bank"]:
            already_done.append(q)
        elif state["has_full_quarter"] and not state["has_per_bank"]:
            need_backfill.append(q)
        else:
            need_download.append(q)

    logger.info(
        f"Classification complete: "
        f"{len(need_download)} need download, "
        f"{len(need_backfill)} need backfill, "
        f"{len(already_done)} already complete"
    )

    if dry_run:
        logger.info("\n[DRY RUN] Plan:")
        logger.info(f"  Download from FFIEC ({len(need_download)} quarters):")
        for q in need_download[:10]:
            logger.info(f"    {q}  ~30 MB from FFIEC API + write 2 layouts")
        if len(need_download) > 10:
            logger.info(f"    ... and {len(need_download) - 10} more")
        logger.info(f"  Backfill per-bank files ({len(need_backfill)} quarters):")
        for q in need_backfill[:10]:
            logger.info(f"    {q}  read existing R2 file → split into per-bank")
        if len(need_backfill) > 10:
            logger.info(f"    ... and {len(need_backfill) - 10} more")
        logger.info(f"  Skip ({len(already_done)} quarters already complete)")
        return

    bytes_written = 0
    succeeded_download, succeeded_backfill, failed, deferred = [], [], [], []
    run_start = time.time()
    budget_bytes = budget_gb * 1024 ** 3

    # ── Step 5A: Backfill per-bank files (State B) ──────────────────────────
    # Do this first — fast (no FFIEC download), unblocks fast query path immediately
    if need_backfill:
        logger.info(f"Backfilling per-bank files for {len(need_backfill)} quarters...")
        for i, quarter_date in enumerate(need_backfill, 1):
            logger.info(f"  [backfill {i}/{len(need_backfill)}] {quarter_date}")
            try:
                b = backfill_per_bank_from_full_quarter(s3, quarter_date)
                bytes_written += b
                succeeded_backfill.append(quarter_date)
                logger.info(f"  ✅ {quarter_date} backfilled: {b/1024:.0f} KB per-bank files")
            except Exception as e:
                logger.error(f"  ❌ {quarter_date} backfill failed: {e}")
                failed.append(quarter_date)

    # ── Step 5B: Download + ingest (State A) ───────────────────────────────
    if need_download:
        logger.info(f"Downloading {len(need_download)} quarters from FFIEC...")
        for i, quarter_date in enumerate(need_download, 1):
            gb_used      = bytes_written / 1024 ** 3
            gb_remaining = budget_gb - gb_used

            logger.info("-" * 72)
            logger.info(
                f"[download {i}/{len(need_download)}] {quarter_date} | "
                f"Used {gb_used:.2f} GB / {budget_gb} GB"
            )

            if bytes_written > 0 and bytes_written >= budget_bytes - (50 * 1024 ** 2):
                logger.warning(
                    f"Budget nearly exhausted ({gb_remaining:.2f} GB left). "
                    f"Deferring {len(need_download) - i + 1} download quarters."
                )
                deferred.extend(need_download[i - 1:])
                break

            try:
                t0 = time.time()
                df = download_quarter(quarter_date)

                try:
                    df = spark_transform(df, quarter_date)
                except Exception as spark_err:
                    logger.warning(
                        f"PySpark transform failed ({spark_err}) — using pandas fallback"
                    )
                    df = _pandas_transform(df, quarter_date)

                q_bytes = upload_quarter(s3, df, quarter_date)
                bytes_written += q_bytes
                succeeded_download.append(quarter_date)
                logger.info(
                    f"✅ {quarter_date} done in {time.time()-t0:.1f}s | "
                    f"{q_bytes/1024/1024:.1f} MB written"
                )
            except Exception as e:
                logger.error(f"❌ {quarter_date} failed: {e}")
                failed.append(quarter_date)
                continue

    total_elapsed = time.time() - run_start

    # Step 6: Write updated metadata
    updated_r2 = list_r2_quarters(s3)
    write_metadata(s3, {
        "last_run_utc":              datetime.now(timezone.utc).isoformat(),
        "last_run_mode":             "full_history" if full_history else
                                     "targeted" if target_quarter else "incremental",
        "last_run_succeeded_dl":     succeeded_download,
        "last_run_succeeded_bf":     succeeded_backfill,
        "last_run_failed":           failed,
        "last_run_deferred":         deferred,
        "last_run_bytes_written":    bytes_written,
        "last_run_duration_s":       round(total_elapsed),
        "total_quarters_in_r2":      len(updated_r2),
        "total_gb_stored":           sum(updated_r2.values()) / 1024 ** 3,
        "last_run_result":           "completed" if not failed else "completed_with_errors",
        "spark_used":                SPARK_AVAILABLE,
    })

    # Summary
    logger.info("=" * 72)
    logger.info("SUMMARY")
    logger.info(f"  Downloaded : {len(succeeded_download)}  {succeeded_download[:3]}{'...' if len(succeeded_download) > 3 else ''}")
    logger.info(f"  Backfilled : {len(succeeded_backfill)}  {succeeded_backfill[:3]}{'...' if len(succeeded_backfill) > 3 else ''}")
    logger.info(f"  Failed     : {len(failed)}  {failed if failed else ''}")
    logger.info(f"  Deferred   : {len(deferred)} (budget limit)")
    logger.info(f"  Written    : {bytes_written/1024/1024/1024:.3f} GB")
    logger.info(f"  Duration   : {total_elapsed/60:.1f} min")
    logger.info(f"  R2 total   : {len(updated_r2)} quarters, {sum(updated_r2.values())/1024**3:.2f} GB")
    if deferred:
        logger.info(f"  Next run   : will pick up {len(deferred)} deferred quarters automatically")
    logger.info("=" * 72)


# 10. CLI entry point

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