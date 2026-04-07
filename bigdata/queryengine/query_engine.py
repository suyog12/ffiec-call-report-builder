"""
query_engine.py  —  DuckDB + Cloudflare R2 Query Layer
=======================================================
William & Mary MSBA Team 9 · Class of 2026

Query strategy for maximum retrieval speed
-------------------------------------------
Single-bank queries (ratios, trends, all-columns):
    → Check for per-bank file first: ubpr/by_bank/{rssd_id}/{quarter}.parquet
    → If found: read ~10-20 KB file directly (sub-50ms)
    → If not found: fall back to full-quarter file with WHERE rssd_id = ?

Multi-bank / peer queries:
    → Always use full-quarter file: ubpr/year={Y}/quarter={Q}/data.parquet
    → DuckDB columnar pushdown reads only requested columns

Data availability:
    → list_available_quarters() reflects what is ACTUALLY in R2
    → Callers should only request quarters that exist — the API layer
      enforces this so users never see empty charts or misleading zeros

Caching:
    → In-process LRU cache keyed by query fingerprint (MD5)
    → TTL: 1 hour (UBPR data is quarterly — never changes within a quarter)
    → Cache is cleared after ingestion runs
"""

from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
from collections import OrderedDict
from typing import Optional

import boto3
import duckdb
import pandas as pd
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

logger = logging.getLogger(__name__)

# ── R2 credentials ─────────────────────────────────────────────────────────────
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

# ── LRU cache ─────────────────────────────────────────────────────────────────
_CACHE_MAX   = 512           # max entries
_CACHE_TTL   = 3_600         # 1 hour in seconds
_cache:       OrderedDict = OrderedDict()
_cache_times: dict        = {}
_cache_lock               = threading.Lock()

# ── Per-bank file availability cache ─────────────────────────────────────────
# Avoids repeated HEAD requests for the same rssd_id × quarter
_bank_file_cache:      dict = {}   # (rssd_id, quarter) → True/False
_bank_file_cache_lock        = threading.Lock()


# Cache helpers

def _ck(*parts) -> str:
    return hashlib.md5(":".join(str(p) for p in parts).encode()).hexdigest()


def _cache_get(key: str):
    with _cache_lock:
        if key not in _cache:
            return None
        if time.time() - _cache_times[key] > _CACHE_TTL:
            del _cache[key]
            del _cache_times[key]
            return None
        _cache.move_to_end(key)
        return _cache[key]


def _cache_set(key: str, value) -> None:
    with _cache_lock:
        _cache[key] = value
        _cache_times[key] = time.time()
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX:
            oldest = next(iter(_cache))
            del _cache[oldest]
            del _cache_times[oldest]


def cache_clear() -> None:
    """Flush all in-process caches. Call after a new ingestion run."""
    with _cache_lock:
        _cache.clear()
        _cache_times.clear()
    with _bank_file_cache_lock:
        _bank_file_cache.clear()
    logger.info("Query cache cleared.")


# DuckDB connection factory

def _new_con() -> duckdb.DuckDBPyConnection:
    """
    Create a fresh DuckDB connection configured for Cloudflare R2 via httpfs.
    DuckDB connections are NOT thread-safe — create one per query, close in finally.
    """
    if not _S3_HOST or not ACCESS_KEY or not SECRET_KEY:
        raise RuntimeError(
            "R2 credentials missing. "
            "Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in .env"
        )
    con = duckdb.connect()
    try:
        con.execute("INSTALL httpfs; LOAD httpfs;")
        con.execute(f"""
            SET s3_endpoint          = '{_S3_HOST}';
            SET s3_access_key_id     = '{ACCESS_KEY}';
            SET s3_secret_access_key = '{SECRET_KEY}';
            SET s3_region            = 'auto';
            SET s3_use_ssl           = true;
            SET s3_url_style         = 'path';
        """)
    except Exception:
        con.close()
        raise
    return con


# R2 URL helpers

def _quarter_url(quarter_date: str) -> str:
    """Full-quarter Parquet: all banks × all columns."""
    year = quarter_date[:4]
    return f"s3://{BUCKET}/ubpr/year={year}/quarter={quarter_date}/data.parquet"


def _bank_url(rssd_id: str, quarter_date: str) -> str:
    """Per-bank Parquet: one bank × all columns, ~10-20 KB."""
    return f"s3://{BUCKET}/ubpr/by_bank/{rssd_id}/{quarter_date}.parquet"


def _bank_file_exists(rssd_id: str, quarter_date: str) -> bool:
    """
    Check R2 for per-bank file existence using S3 HEAD request.
    Result is cached permanently — files don't disappear once written.
    """
    ck = (rssd_id, quarter_date)
    with _bank_file_cache_lock:
        if ck in _bank_file_cache:
            return _bank_file_cache[ck]

    try:
        s3 = boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT,
            aws_access_key_id=ACCESS_KEY,
            aws_secret_access_key=SECRET_KEY,
            region_name="auto",
        )
        key = f"ubpr/by_bank/{rssd_id}/{quarter_date}.parquet"
        s3.head_object(Bucket=BUCKET, Key=key)
        exists = True
    except Exception:
        exists = False

    with _bank_file_cache_lock:
        _bank_file_cache[ck] = exists

    return exists


def _get_parquet_columns(con: duckdb.DuckDBPyConnection, url: str) -> set[str]:
    """Return column names present in a Parquet file."""
    rows = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{url}')").fetchall()
    return {row[0] for row in rows}


def _safe_cols(columns: list[str], schema_cols: set[str]) -> list[str]:
    """
    Intersect requested columns with schema columns.
    Filters out any column name containing non-alphanumeric/underscore chars
    as a SQL injection guard.
    """
    return [
        c for c in columns
        if c.replace("_", "").isalnum() and c in schema_cols
    ]


# Public query functions

def query_ratios(
    rssd_id: str,
    quarter_date: str,
    columns: list[str],
) -> pd.DataFrame:
    """
    Fetch specific UBPR columns for one bank × one quarter.

    Speed strategy:
        1. Check LRU cache (microseconds)
        2. If per-bank file exists → read ~15 KB file (sub-50ms)
        3. Otherwise → scan full-quarter file with WHERE clause (100-300ms)

    Returns empty DataFrame if the bank has no data for this quarter.
    Caller should check df.empty before using the result.
    """
    key = _ck("ratios", rssd_id, quarter_date, tuple(sorted(columns)))
    hit = _cache_get(key)
    if hit is not None:
        return hit

    # Choose URL — per-bank file is much faster for single-bank queries
    if _bank_file_exists(rssd_id, quarter_date):
        url       = _bank_url(rssd_id, quarter_date)
        where     = ""  # file already contains only this bank
    else:
        url       = _quarter_url(quarter_date)
        where     = f"WHERE rssd_id = '{rssd_id}'"

    con = _new_con()
    try:
        schema_cols = _get_parquet_columns(con, url)
        safe        = _safe_cols(columns, schema_cols)

        if not safe:
            logger.warning(
                f"query_ratios: no matching columns for {rssd_id} {quarter_date} "
                f"(requested {len(columns)}, schema has {len(schema_cols)})"
            )
            return pd.DataFrame()

        col_expr = ", ".join(f'"{c}"' for c in ["rssd_id", "quarter_date"] + safe)
        t0  = time.time()
        df  = con.execute(
            f"SELECT {col_expr} FROM read_parquet('{url}') {where}"
        ).df()

        logger.info(
            f"query_ratios {rssd_id} {quarter_date} "
            f"→ {len(df)} rows, {len(safe)} cols, {time.time()-t0:.3f}s "
            f"({'bank-file' if not where else 'quarter-scan'})"
        )
    finally:
        con.close()

    _cache_set(key, df)
    return df


def query_trend(
    rssd_id: str,
    quarter_dates: list[str],
    columns: list[str],
) -> pd.DataFrame:
    """
    Fetch ratio columns across multiple quarters for one bank.

    Uses per-bank files where available (fast) and full-quarter files as fallback.
    Silently skips quarters where this bank has no data — callers should not
    assume every quarter has data for every bank.

    Returns a DataFrame with one row per available quarter, sorted oldest → newest.
    """
    key = _ck("trend", rssd_id, tuple(sorted(quarter_dates)), tuple(sorted(columns)))
    hit = _cache_get(key)
    if hit is not None:
        return hit

    frames = []
    for qd in sorted(quarter_dates):  # process chronologically for cleaner logs
        try:
            df = query_ratios(rssd_id, qd, columns)
            if not df.empty:
                frames.append(df)
        except Exception as e:
            logger.warning(f"Skipping {qd} in trend for {rssd_id}: {e}")

    result = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if not result.empty and "quarter_date" in result.columns:
        result = result.sort_values("quarter_date").reset_index(drop=True)

    _cache_set(key, result)
    return result


def query_peer_averages(
    quarter_date: str,
    columns: list[str],
) -> pd.DataFrame:
    """
    Compute column averages across ALL banks for a given quarter.

    Always uses the full-quarter file — per-bank files don't help here
    since we need all banks. DuckDB's columnar scan reads only the
    requested columns.

    Returns one row with average values. Uses TRY_CAST so non-numeric
    stragglers don't crash the aggregation.
    """
    key = _ck("peer", quarter_date, tuple(sorted(columns)))
    hit = _cache_get(key)
    if hit is not None:
        return hit

    safe     = [c for c in columns if c.replace("_", "").isalnum()]
    avg_expr = ", ".join(
        f'AVG(TRY_CAST("{c}" AS DOUBLE)) AS "{c}"' for c in safe
    )
    url = _quarter_url(quarter_date)

    con = _new_con()
    try:
        t0 = time.time()
        df = con.execute(f"SELECT {avg_expr} FROM read_parquet('{url}')").df()
        logger.info(f"query_peer_averages {quarter_date} → {time.time()-t0:.3f}s")
    finally:
        con.close()

    _cache_set(key, df)
    return df


def query_all_columns(
    rssd_id: str,
    quarter_date: str,
) -> pd.DataFrame:
    """
    Fetch ALL columns for one bank × one quarter.
    Used by the custom ratio builder.

    Uses per-bank file if available (reads only ~15 KB vs ~30 MB).
    Returns empty DataFrame if bank has no data for this quarter.
    """
    key = _ck("all", rssd_id, quarter_date)
    hit = _cache_get(key)
    if hit is not None:
        return hit

    if _bank_file_exists(rssd_id, quarter_date):
        url   = _bank_url(rssd_id, quarter_date)
        where = ""
    else:
        url   = _quarter_url(quarter_date)
        where = f"WHERE rssd_id = '{rssd_id}'"

    con = _new_con()
    try:
        t0 = time.time()
        df = con.execute(f"SELECT * FROM read_parquet('{url}') {where}").df()
        logger.info(
            f"query_all_columns {rssd_id} {quarter_date} "
            f"→ {len(df.columns)} cols, {time.time()-t0:.3f}s"
        )
    finally:
        con.close()

    _cache_set(key, df)
    return df


def query_multi_bank(
    rssd_ids: list[str],
    quarter_date: str,
    columns: list[str],
) -> pd.DataFrame:
    """
    Fetch columns for multiple banks in a single Parquet scan.
    Used by the Multi-Bank Compare tab.

    Always uses full-quarter file (scanning for N banks in one pass
    is faster than N separate per-bank file reads).
    """
    key = _ck("multi", tuple(sorted(rssd_ids)), quarter_date, tuple(sorted(columns)))
    hit = _cache_get(key)
    if hit is not None:
        return hit

    safe     = [c for c in columns if c.replace("_", "").isalnum()]
    col_expr = ", ".join(f'"{c}"' for c in ["rssd_id", "quarter_date"] + safe)
    ids_expr = ", ".join(f"'{r}'" for r in rssd_ids)
    url      = _quarter_url(quarter_date)

    con = _new_con()
    try:
        t0 = time.time()
        df = con.execute(
            f"SELECT {col_expr} FROM read_parquet('{url}') "
            f"WHERE rssd_id IN ({ids_expr})"
        ).df()
        logger.info(
            f"query_multi_bank {quarter_date} {len(rssd_ids)} banks "
            f"→ {len(df)} rows, {time.time()-t0:.3f}s"
        )
    finally:
        con.close()

    _cache_set(key, df)
    return df


def bank_has_data(rssd_id: str, quarter_date: str) -> bool:
    """
    Check whether a specific bank has any data for a given quarter.
    Uses per-bank file existence as a proxy — fast HEAD request.
    Falls back to a lightweight query if per-bank files haven't been written yet.

    Use this before making any query to avoid showing empty charts or
    misleading zeros to users.
    """
    # Fast path: per-bank file existence
    if _bank_file_exists(rssd_id, quarter_date):
        return True

    # Slow path: check full-quarter file
    ck = _ck("has_data", rssd_id, quarter_date)
    hit = _cache_get(ck)
    if hit is not None:
        return hit

    con = _new_con()
    try:
        url = _quarter_url(quarter_date)
        df  = con.execute(
            f"SELECT rssd_id FROM read_parquet('{url}') "
            f"WHERE rssd_id = '{rssd_id}' LIMIT 1"
        ).df()
        result = len(df) > 0
    except Exception:
        result = False
    finally:
        con.close()

    _cache_set(ck, result)
    return result


# Quarter discovery

def list_available_quarters() -> list[str]:
    """
    Return all quarter_dates that are actually stored in R2.
    Sorted oldest → newest (e.g. ['20010331', ..., '20251231']).

    This is the authoritative source of truth for what the dashboard
    can display — never show quarters that aren't in R2.
    """
    key = _ck("quarters")
    hit = _cache_get(key)
    if hit is not None:
        return hit

    s3 = boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        region_name="auto",
    )

    quarters  = []
    paginator = s3.get_paginator("list_objects_v2")

    # Walk ubpr/year=.../quarter=.../data.parquet hierarchy
    for page in paginator.paginate(Bucket=BUCKET, Prefix="ubpr/year=", Delimiter="/"):
        for year_prefix in page.get("CommonPrefixes", []):
            for page2 in paginator.paginate(
                Bucket=BUCKET, Prefix=year_prefix["Prefix"], Delimiter="/"
            ):
                for q_prefix in page2.get("CommonPrefixes", []):
                    part  = q_prefix["Prefix"].rstrip("/").split("/")[-1]
                    qdate = part.replace("quarter=", "")
                    if qdate.isdigit() and len(qdate) == 8:
                        quarters.append(qdate)

    quarters = sorted(set(quarters))  # oldest → newest, deduplicated
    _cache_set(key, quarters)
    logger.info(
        f"list_available_quarters: {len(quarters)} quarters "
        f"({quarters[0] if quarters else '?'} → {quarters[-1] if quarters else '?'})"
    )
    return quarters


# Health check

def ping_r2() -> dict:
    """Quick connectivity check — returns status and quarter count."""
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