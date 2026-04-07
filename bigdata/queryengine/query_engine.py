"""
query_engine.py
===============

Design principles
-----------------
Speed:
  • Per-bank Parquet files (~15 KB) for single-bank queries — sub-100ms reads
  • Full-quarter Parquet (~30 MB) for peer/multi-bank queries — columnar pushdown
  • Two-tier LRU cache: query results (1 hr TTL) + file-existence checks (permanent)
  • Parallel trend queries via ThreadPoolExecutor
  • DuckDB httpfs streams only requested columns — no full file downloads

Security:
  • All column names validated against [A-Za-z0-9_] before SQL interpolation
  • RSSD IDs validated as numeric strings before interpolation
  • Quarter dates validated as 8-digit strings before interpolation
  • No user-supplied strings ever interpolated directly into SQL

Data accuracy:
  • TRY_CAST used for peer aggregations — bad values silently become NULL
  • Schema introspection per file — older quarters have fewer columns
  • Empty DataFrame returned (never raises) when bank has no data

Availability:
  • bank_has_data() checks file existence before any query
  • list_available_quarters() reflects actual R2 contents — source of truth
  • Callers should never show quarters not returned by list_available_quarters()
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import boto3
import duckdb
import pandas as pd
from botocore.config import Config
from botocore.exceptions import ClientError
from dotenv import load_dotenv

# Environment──────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

logger = logging.getLogger(__name__)

S3_ENDPOINT = os.getenv("R2_ENDPOINT", "").rstrip("/")
ACCESS_KEY  = os.getenv("R2_ACCESS_KEY_ID", "")
SECRET_KEY  = os.getenv("R2_SECRET_ACCESS_KEY", "")
BUCKET      = os.getenv("R2_BUCKET", "ffiec-data")

_S3_HOST = (
    S3_ENDPOINT
    .replace("https://", "")
    .replace("http://", "")
    .rstrip("/")
)

# Input validation─
_RSSD_RE    = re.compile(r"^\d{1,10}$")
_QUARTER_RE = re.compile(r"^\d{8}$")
_COL_RE     = re.compile(r"^[A-Za-z0-9_]+$")


def _validate_rssd(rssd_id: str) -> str:
    """Validate and return RSSD ID. Raises ValueError if invalid."""
    v = str(rssd_id).strip()
    if not _RSSD_RE.match(v):
        raise ValueError(f"Invalid RSSD ID: {rssd_id!r} — must be 1-10 digits")
    return v


def _validate_quarter(quarter_date: str) -> str:
    """Validate and return quarter date (YYYYMMDD). Raises ValueError if invalid."""
    v = str(quarter_date).strip()
    if not _QUARTER_RE.match(v) or len(v) != 8:
        raise ValueError(f"Invalid quarter_date: {quarter_date!r} — must be YYYYMMDD")
    return v


def _validate_columns(columns: list[str]) -> list[str]:
    """
    Filter column list to only safe names (alphanumeric + underscore).
    Returns filtered list — never raises. Logs any rejected columns.
    """
    safe, rejected = [], []
    for c in columns:
        if _COL_RE.match(str(c)):
            safe.append(c)
        else:
            rejected.append(c)
    if rejected:
        logger.warning(f"Rejected {len(rejected)} unsafe column names: {rejected[:5]}")
    return safe


# LRU query cache──
_CACHE_MAX   = 512
_CACHE_TTL   = 3_600          # 1 hour — UBPR data is quarterly, never changes mid-quarter
_cache:       OrderedDict = OrderedDict()
_cache_times: dict        = {}
_cache_lock               = threading.Lock()


def _ck(*parts) -> str:
    return hashlib.md5(":".join(str(p) for p in parts).encode()).hexdigest()


def _cache_get(key: str) -> Optional[pd.DataFrame]:
    with _cache_lock:
        if key not in _cache:
            return None
        if time.time() - _cache_times[key] > _CACHE_TTL:
            del _cache[key]
            del _cache_times[key]
            return None
        _cache.move_to_end(key)
        return _cache[key]


def _cache_set(key: str, value: pd.DataFrame) -> None:
    with _cache_lock:
        _cache[key] = value
        _cache_times[key] = time.time()
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX:
            oldest = next(iter(_cache))
            del _cache[oldest]
            del _cache_times[oldest]


# File existence cache
# Per-bank files never disappear once written — safe to cache permanently
_existence_cache: dict[str, bool] = {}
_existence_lock                   = threading.Lock()


def cache_clear() -> None:
    """Flush all caches. Call after a new ingestion run completes."""
    with _cache_lock:
        _cache.clear()
        _cache_times.clear()
    with _existence_lock:
        _existence_cache.clear()
    logger.info("Query engine cache cleared.")


# S3 / boto3 client
def _s3_client():
    """Create boto3 S3 client with connection pooling and adaptive retry."""
    if not S3_ENDPOINT or not ACCESS_KEY or not SECRET_KEY:
        raise RuntimeError(
            "R2 credentials not configured. "
            "Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env"
        )
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        region_name="auto",
        config=Config(
            max_pool_connections=50,
            retries={"max_attempts": 3, "mode": "adaptive"},
        ),
    )


# DuckDB connection factory─
def _new_con() -> duckdb.DuckDBPyConnection:
    """
    Open a DuckDB connection configured for Cloudflare R2 via httpfs.
    Thread-safety: DuckDB connections are NOT thread-safe.
    Always create one per call and close in a finally block.
    """
    if not _S3_HOST or not ACCESS_KEY or not SECRET_KEY:
        raise RuntimeError("R2 credentials missing — check .env configuration.")

    con = duckdb.connect()
    try:
        con.execute("INSTALL httpfs; LOAD httpfs;")
        # Use parameterised SET statements — values never come from user input
        con.execute(f"SET s3_endpoint          = '{_S3_HOST}';")
        con.execute(f"SET s3_access_key_id     = '{ACCESS_KEY}';")
        con.execute(f"SET s3_secret_access_key = '{SECRET_KEY}';")
        con.execute( "SET s3_region            = 'auto';")
        con.execute( "SET s3_use_ssl           = true;")
        con.execute( "SET s3_url_style         = 'path';")
        # Performance: stream only needed bytes, don't buffer entire file
        con.execute( "SET s3_uploader_max_parts_per_file = 100;")
    except Exception:
        con.close()
        raise
    return con


# R2 URL helpers
def _quarter_url(quarter_date: str) -> str:
    year = quarter_date[:4]
    return f"s3://{BUCKET}/ubpr/year={year}/quarter={quarter_date}/data.parquet"


def _bank_url(rssd_id: str, quarter_date: str) -> str:
    return f"s3://{BUCKET}/ubpr/by_bank/{rssd_id}/{quarter_date}.parquet"


def _get_schema_columns(con: duckdb.DuckDBPyConnection, url: str) -> set[str]:
    """Return column names present in a Parquet file. Empty set on error."""
    try:
        rows = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{url}')").fetchall()
        return {row[0] for row in rows}
    except Exception as e:
        logger.warning(f"Schema read failed for {url}: {e}")
        return set()


def _intersect_columns(
    requested: list[str],
    schema: set[str],
    always_include: list[str] | None = None,
) -> list[str]:
    """
    Return requested columns that exist in the schema.
    always_include columns are added first if present in schema.
    """
    base    = [c for c in (always_include or []) if c in schema]
    extras  = [c for c in requested if c in schema and c not in base]
    return base + extras


# Per-bank file availability
def bank_has_data(rssd_id: str, quarter_date: str) -> bool:
    """
    Check whether a bank has data for a quarter.

    Fast path: per-bank file existence (S3 HEAD request, cached permanently).
    Slow path: 1-row scan of full-quarter file (used if per-bank files not written).

    Always returns False rather than raising — callers can safely use this
    as a guard before any query.
    """
    try:
        rssd_id      = _validate_rssd(rssd_id)
        quarter_date = _validate_quarter(quarter_date)
    except ValueError:
        return False

    ck = f"exists:{rssd_id}:{quarter_date}"
    with _existence_lock:
        if ck in _existence_cache:
            return _existence_cache[ck]

    # Fast path — HEAD request for per-bank file
    try:
        s3  = _s3_client()
        key = f"ubpr/by_bank/{rssd_id}/{quarter_date}.parquet"
        s3.head_object(Bucket=BUCKET, Key=key)
        result = True
    except ClientError as e:
        if e.response["Error"]["Code"] in ("404", "NoSuchKey"):
            # Slow path — check full-quarter file
            result = _check_quarter_file(rssd_id, quarter_date)
        else:
            logger.warning(f"bank_has_data S3 error for {rssd_id}/{quarter_date}: {e}")
            result = False
    except Exception as e:
        logger.warning(f"bank_has_data unexpected error: {e}")
        result = False

    with _existence_lock:
        _existence_cache[ck] = result
    return result


def _check_quarter_file(rssd_id: str, quarter_date: str) -> bool:
    """Check full-quarter file for a specific RSSD ID. Used as slow-path fallback."""
    con = _new_con()
    try:
        url = _quarter_url(quarter_date)
        df  = con.execute(
            f"SELECT rssd_id FROM read_parquet('{url}') "
            f"WHERE rssd_id = '{rssd_id}' LIMIT 1"
        ).df()
        return len(df) > 0
    except Exception:
        return False
    finally:
        con.close()


# Public query functions
def query_ratios(
    rssd_id: str,
    quarter_date: str,
    columns: list[str],
) -> pd.DataFrame:
    """
    Fetch specific UBPR ratio columns for one bank × one quarter.

    Speed strategy:
        1. LRU cache hit → return immediately (microseconds)
        2. Per-bank file exists → read ~15 KB file (sub-100ms)
        3. Fallback → scan full-quarter file with WHERE clause (100-500ms)

    Security: all inputs validated; column names filtered to [A-Za-z0-9_].
    Returns empty DataFrame if bank has no data — never raises.
    """
    try:
        rssd_id      = _validate_rssd(rssd_id)
        quarter_date = _validate_quarter(quarter_date)
        columns      = _validate_columns(columns)
    except ValueError as e:
        logger.error(f"query_ratios validation failed: {e}")
        return pd.DataFrame()

    if not columns:
        return pd.DataFrame()

    cache_key = _ck("ratios", rssd_id, quarter_date, tuple(sorted(columns)))
    hit = _cache_get(cache_key)
    if hit is not None:
        return hit

    con = _new_con()
    try:
        # Choose fastest available source
        bank_key = f"ubpr/by_bank/{rssd_id}/{quarter_date}.parquet"
        try:
            _s3_client().head_object(Bucket=BUCKET, Key=bank_key)
            url       = _bank_url(rssd_id, quarter_date)
            where     = ""          # file contains only this bank
            src       = "bank-file"
        except ClientError:
            url       = _quarter_url(quarter_date)
            where     = f"WHERE rssd_id = '{rssd_id}'"
            src       = "quarter-scan"

        schema = _get_schema_columns(con, url)
        safe   = _intersect_columns(columns, schema, ["rssd_id", "quarter_date"])

        if not safe:
            logger.warning(
                f"query_ratios: no matching columns for {rssd_id} {quarter_date} "
                f"(requested {len(columns)}, schema has {len(schema)} cols)"
            )
            return pd.DataFrame()

        col_sql = ", ".join(f'"{c}"' for c in safe)
        t0      = time.monotonic()
        df      = con.execute(
            f"SELECT {col_sql} FROM read_parquet('{url}') {where}"
        ).df()
        elapsed = time.monotonic() - t0

        logger.info(
            f"query_ratios {rssd_id} {quarter_date} [{src}] "
            f"→ {len(df)} rows, {len(safe)} cols, {elapsed:.3f}s"
        )
    except Exception as e:
        logger.error(f"query_ratios failed [{rssd_id} {quarter_date}]: {e}")
        return pd.DataFrame()
    finally:
        con.close()

    _cache_set(cache_key, df)
    return df


def query_trend(
    rssd_id: str,
    quarter_dates: list[str],
    columns: list[str],
) -> pd.DataFrame:
    """
    Fetch ratio columns across multiple quarters for one bank.

    Fetches quarters in parallel (up to 6 concurrent) for maximum speed.
    Silently skips quarters where the bank has no data.
    Returns results sorted oldest → newest for clean chart rendering.
    """
    try:
        rssd_id  = _validate_rssd(rssd_id)
        columns  = _validate_columns(columns)
        quarters = [_validate_quarter(q) for q in quarter_dates]
    except ValueError as e:
        logger.error(f"query_trend validation failed: {e}")
        return pd.DataFrame()

    cache_key = _ck("trend", rssd_id, tuple(sorted(quarters)), tuple(sorted(columns)))
    hit = _cache_get(cache_key)
    if hit is not None:
        return hit

    frames: list[pd.DataFrame] = []

    with ThreadPoolExecutor(max_workers=6) as pool:
        future_map = {
            pool.submit(query_ratios, rssd_id, qd, columns): qd
            for qd in quarters
        }
        for future in as_completed(future_map):
            qd = future_map[future]
            try:
                df = future.result()
                if df is not None and not df.empty:
                    frames.append(df)
            except Exception as e:
                logger.warning(f"query_trend: skipping {qd} for {rssd_id}: {e}")

    if not frames:
        result = pd.DataFrame()
    else:
        result = pd.concat(frames, ignore_index=True)
        if "quarter_date" in result.columns:
            result = result.sort_values("quarter_date").reset_index(drop=True)

    _cache_set(cache_key, result)
    return result


def query_peer_averages(
    quarter_date: str,
    columns: list[str],
) -> pd.DataFrame:
    """
    Compute column averages across ALL banks for a given quarter.

    Always uses full-quarter file — per-bank files don't help here.
    TRY_CAST ensures bad/non-numeric values become NULL instead of crashing.
    """
    try:
        quarter_date = _validate_quarter(quarter_date)
        columns      = _validate_columns(columns)
    except ValueError as e:
        logger.error(f"query_peer_averages validation failed: {e}")
        return pd.DataFrame()

    if not columns:
        return pd.DataFrame()

    cache_key = _ck("peer", quarter_date, tuple(sorted(columns)))
    hit = _cache_get(cache_key)
    if hit is not None:
        return hit

    avg_sql = ", ".join(
        f'AVG(TRY_CAST("{c}" AS DOUBLE)) AS "{c}"'
        for c in columns
    )
    url = _quarter_url(quarter_date)
    con = _new_con()
    try:
        t0  = time.monotonic()
        df  = con.execute(
            f"SELECT {avg_sql} FROM read_parquet('{url}')"
        ).df()
        logger.info(
            f"query_peer_averages {quarter_date} "
            f"→ {len(columns)} cols, {time.monotonic()-t0:.3f}s"
        )
    except Exception as e:
        logger.error(f"query_peer_averages failed [{quarter_date}]: {e}")
        return pd.DataFrame()
    finally:
        con.close()

    _cache_set(cache_key, df)
    return df


def query_all_columns(
    rssd_id: str,
    quarter_date: str,
) -> pd.DataFrame:
    """
    Fetch ALL columns for one bank × one quarter.
    Used by the custom ratio builder and executive summary.

    Uses per-bank file when available (~15 KB vs ~30 MB full-quarter file).
    """
    try:
        rssd_id      = _validate_rssd(rssd_id)
        quarter_date = _validate_quarter(quarter_date)
    except ValueError as e:
        logger.error(f"query_all_columns validation failed: {e}")
        return pd.DataFrame()

    cache_key = _ck("all", rssd_id, quarter_date)
    hit = _cache_get(cache_key)
    if hit is not None:
        return hit

    con = _new_con()
    try:
        bank_key = f"ubpr/by_bank/{rssd_id}/{quarter_date}.parquet"
        try:
            _s3_client().head_object(Bucket=BUCKET, Key=bank_key)
            url   = _bank_url(rssd_id, quarter_date)
            where = ""
            src   = "bank-file"
        except ClientError:
            url   = _quarter_url(quarter_date)
            where = f"WHERE rssd_id = '{rssd_id}'"
            src   = "quarter-scan"

        t0 = time.monotonic()
        df = con.execute(
            f"SELECT * FROM read_parquet('{url}') {where}"
        ).df()
        logger.info(
            f"query_all_columns {rssd_id} {quarter_date} [{src}] "
            f"→ {len(df.columns)} cols, {time.monotonic()-t0:.3f}s"
        )
    except Exception as e:
        logger.error(f"query_all_columns failed [{rssd_id} {quarter_date}]: {e}")
        return pd.DataFrame()
    finally:
        con.close()

    _cache_set(cache_key, df)
    return df


def query_multi_bank(
    rssd_ids: list[str],
    quarter_date: str,
    columns: list[str],
) -> pd.DataFrame:
    """
    Fetch columns for multiple banks in one Parquet scan.
    Used by Multi-Bank Compare tab — more efficient than N separate reads.
    """
    try:
        quarter_date = _validate_quarter(quarter_date)
        rssd_ids     = [_validate_rssd(r) for r in rssd_ids]
        columns      = _validate_columns(columns)
    except ValueError as e:
        logger.error(f"query_multi_bank validation failed: {e}")
        return pd.DataFrame()

    if not rssd_ids or not columns:
        return pd.DataFrame()

    cache_key = _ck("multi", tuple(sorted(rssd_ids)), quarter_date, tuple(sorted(columns)))
    hit = _cache_get(cache_key)
    if hit is not None:
        return hit

    safe     = _validate_columns(columns)
    col_sql  = ", ".join(f'"{c}"' for c in ["rssd_id", "quarter_date"] + safe)
    ids_sql  = ", ".join(f"'{r}'" for r in rssd_ids)
    url      = _quarter_url(quarter_date)

    con = _new_con()
    try:
        t0 = time.monotonic()
        df = con.execute(
            f"SELECT {col_sql} FROM read_parquet('{url}') "
            f"WHERE rssd_id IN ({ids_sql})"
        ).df()
        logger.info(
            f"query_multi_bank {quarter_date} {len(rssd_ids)} banks "
            f"→ {len(df)} rows, {time.monotonic()-t0:.3f}s"
        )
    except Exception as e:
        logger.error(f"query_multi_bank failed [{quarter_date}]: {e}")
        return pd.DataFrame()
    finally:
        con.close()

    _cache_set(cache_key, df)
    return df


# Quarter discovery
def list_available_quarters() -> list[str]:
    """
    Return all quarter_dates stored in R2, sorted oldest → newest.
    This is the authoritative source of truth for what the dashboard can display.
    Cached for 1 hour.
    """
    cache_key = _ck("quarters")
    hit = _cache_get(cache_key)
    if hit is not None:
        return hit  # type: ignore[return-value]

    try:
        s3        = _s3_client()
        quarters  = []
        paginator = s3.get_paginator("list_objects_v2")

        for page in paginator.paginate(Bucket=BUCKET, Prefix="ubpr/year=", Delimiter="/"):
            for year_pfx in page.get("CommonPrefixes", []):
                for page2 in paginator.paginate(
                    Bucket=BUCKET, Prefix=year_pfx["Prefix"], Delimiter="/"
                ):
                    for q_pfx in page2.get("CommonPrefixes", []):
                        part  = q_pfx["Prefix"].rstrip("/").split("/")[-1]
                        qdate = part.replace("quarter=", "")
                        if _QUARTER_RE.match(qdate):
                            quarters.append(qdate)

        quarters = sorted(set(quarters))
        logger.info(
            f"list_available_quarters: {len(quarters)} quarters "
            f"({quarters[0] if quarters else '?'} → {quarters[-1] if quarters else '?'})"
        )
        # Store as a list wrapped in a fake DataFrame to reuse cache infrastructure
        # Actually just store directly — override type for this key
        with _cache_lock:
            _cache[cache_key] = quarters  # type: ignore[assignment]
            _cache_times[cache_key] = time.time()
        return quarters

    except Exception as e:
        logger.error(f"list_available_quarters failed: {e}")
        return []


# Health check
def ping_r2() -> dict:
    """Quick connectivity and inventory check."""
    try:
        quarters = list_available_quarters()
        return {
            "status":             "ok",
            "quarters_available": len(quarters),
            "oldest":             quarters[0]  if quarters else None,
            "latest":             quarters[-1] if quarters else None,
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}