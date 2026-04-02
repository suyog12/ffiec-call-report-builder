import os
import hashlib
import logging
import threading
import time
from collections import OrderedDict

import duckdb
import pandas as pd
import boto3
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

logger = logging.getLogger(__name__)

# ── R2 credentials ─────────────────────────────────────────────────────────────
S3_ENDPOINT = os.getenv("R2_ENDPOINT", "")
ACCESS_KEY  = os.getenv("R2_ACCESS_KEY_ID", "")
SECRET_KEY  = os.getenv("R2_SECRET_ACCESS_KEY", "")
BUCKET      = os.getenv("R2_BUCKET", "ffiec-data")

# DuckDB httpfs wants hostname only, not the full https:// URL
_S3_HOST = (
    S3_ENDPOINT
    .replace("https://", "")
    .replace("http://", "")
    .rstrip("/")
)

# ── In-process LRU cache ───────────────────────────────────────────────────────
_CACHE_MAX   = 256
_CACHE_TTL   = 3600        # 1 hour — data doesn't change within a quarter
_cache: OrderedDict  = OrderedDict()
_cache_times: dict   = {}
_cache_lock          = threading.Lock()


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


def _cache_set(key: str, value):
    with _cache_lock:
        _cache[key] = value
        _cache_times[key] = time.time()
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX:
            oldest = next(iter(_cache))
            del _cache[oldest]
            del _cache_times[oldest]


def _ck(*parts) -> str:
    return hashlib.md5(":".join(str(p) for p in parts).encode()).hexdigest()


def cache_clear():
    """Flush the entire in-process cache. Call after a new ingestion run."""
    with _cache_lock:
        _cache.clear()
        _cache_times.clear()


# ── DuckDB connection factory ──────────────────────────────────────────────────
def _new_con() -> duckdb.DuckDBPyConnection:
    """
    Open a fresh DuckDB connection configured for Cloudflare R2 via httpfs.
    DuckDB connections are NOT thread-safe — always create one per call
    and close it in a finally block.
    """
    if not _S3_HOST or not ACCESS_KEY or not SECRET_KEY:
        raise RuntimeError(
            "R2 credentials missing. "
            "Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in bigdata/.env"
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


def _parquet_url(quarter_date: str) -> str:
    year = quarter_date[:4]
    return f"s3://{BUCKET}/ubpr/year={year}/quarter={quarter_date}/data.parquet"


# ── Public query functions ─────────────────────────────────────────────────────

def _get_parquet_columns(con: duckdb.DuckDBPyConnection, url: str) -> set:
    """Return the set of column names that actually exist in a Parquet file."""
    rows = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{url}')").fetchall()
    return {row[0] for row in rows}


def query_ratios(
    rssd_id: str,
    quarter_date: str,
    columns: list,
) -> pd.DataFrame:
    """
    Fetch specific UBPR columns for one bank x one quarter.
    Only the requested columns are pulled from R2 (columnar pushdown).
    Automatically skips columns that don't exist in older Parquet schemas.
    Cached for 1 hour.
    """
    key = _ck("ratios", rssd_id, quarter_date, tuple(sorted(columns)))
    hit = _cache_get(key)
    if hit is not None:
        return hit

    url = _parquet_url(quarter_date)
    con = _new_con()
    try:
        # Intersect requested columns with what this Parquet actually has
        schema_cols = _get_parquet_columns(con, url)
        safe = [
            c for c in columns
            if c.replace("_", "").isalnum() and c in schema_cols
        ]
        if not safe:
            logger.warning(f"query_ratios {rssd_id} {quarter_date}: no matching columns in schema")
            return pd.DataFrame()

        col_expr = ", ".join(f'"{c}"' for c in ["rssd_id", "quarter_date"] + safe)
        t0 = time.time()
        df = con.execute(f"""
            SELECT {col_expr}
            FROM read_parquet('{url}')
            WHERE rssd_id = '{rssd_id}'
        """).df()
        logger.info(
            f"query_ratios {rssd_id} {quarter_date} "
            f"-> {len(df)} rows, {len(safe)}/{len(columns)} cols in {time.time()-t0:.2f}s"
        )
    finally:
        con.close()

    _cache_set(key, df)
    return df


def query_trend(
    rssd_id: str,
    quarter_dates: list,
    columns: list,
) -> pd.DataFrame:
    """
    Fetch key ratio columns across multiple quarters for one bank.
    Each quarter is one Parquet file; queries run sequentially with caching.
    """
    key = _ck("trend", rssd_id, tuple(sorted(quarter_dates)), tuple(sorted(columns)))
    hit = _cache_get(key)
    if hit is not None:
        return hit

    frames = []
    for qd in quarter_dates:
        try:
            df = query_ratios(rssd_id, qd, columns)
            if not df.empty:
                frames.append(df)
        except Exception as e:
            logger.warning(f"Skipping quarter {qd} in trend for {rssd_id}: {e}")

    result = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    _cache_set(key, result)
    return result


# Asset size thresholds for peer group filtering (in dollars, matching UBPR2170)
_PEER_SIZE_FILTERS = {
    "size:large":     'TRY_CAST("UBPR2170" AS DOUBLE) >= 100000000000',
    "size:mid":       'TRY_CAST("UBPR2170" AS DOUBLE) >= 10000000000 AND TRY_CAST("UBPR2170" AS DOUBLE) < 100000000000',
    "size:community": 'TRY_CAST("UBPR2170" AS DOUBLE) < 10000000000',
    "size:small":     'TRY_CAST("UBPR2170" AS DOUBLE) < 1000000000',
}


def query_peer_averages(
    quarter_date: str,
    columns: list,
    exclude_rssd_id: str | None = None,
    peer_group: str = "all",
) -> pd.DataFrame:
    """
    Compute column averages across banks for a given quarter.
    - exclude_rssd_id: excludes the selected bank from the average
    - peer_group: filters by asset size bucket (all / size:large / size:mid / size:community / size:small)
    Single Parquet scan — only requested columns are read from R2.
    Cached for 1 hour.
    """
    key = _ck("peer", quarter_date, tuple(sorted(columns)), exclude_rssd_id or "", peer_group)
    hit = _cache_get(key)
    if hit is not None:
        return hit

    safe = [c for c in columns if c.replace("_", "").isalnum()]
    avg_exprs = ", ".join(
        f'AVG(TRY_CAST("{c}" AS DOUBLE)) AS "{c}"' for c in safe
    )
    url = _parquet_url(quarter_date)

    # Build WHERE clause
    conditions = []
    if exclude_rssd_id:
        conditions.append(f"rssd_id != '{exclude_rssd_id}'")
    if peer_group in _PEER_SIZE_FILTERS:
        conditions.append(_PEER_SIZE_FILTERS[peer_group])
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    con = _new_con()
    try:
        t0 = time.time()
        df = con.execute(f"""
            SELECT {avg_exprs}
            FROM read_parquet('{url}')
            {where}
        """).df()
        logger.info(
            f"query_peer_averages {quarter_date} group={peer_group} "
            f"exclude={exclude_rssd_id} -> {time.time()-t0:.2f}s"
        )
    finally:
        con.close()

    _cache_set(key, df)
    return df


def query_all_columns(
    rssd_id: str,
    quarter_date: str,
) -> pd.DataFrame:
    """
    Fetch ALL columns for one bank x one quarter.
    Used by the custom ratio builder. Streams only the matching row(s).
    Cached for 1 hour.
    """
    key = _ck("all", rssd_id, quarter_date)
    hit = _cache_get(key)
    if hit is not None:
        return hit

    url = _parquet_url(quarter_date)
    con = _new_con()
    try:
        t0 = time.time()
        df = con.execute(f"""
            SELECT *
            FROM read_parquet('{url}')
            WHERE rssd_id = '{rssd_id}'
        """).df()
        logger.info(
            f"query_all_columns {rssd_id} {quarter_date} -> {time.time()-t0:.2f}s"
        )
    finally:
        con.close()

    _cache_set(key, df)
    return df


def query_multi_bank(
    rssd_ids: list,
    quarter_date: str,
    columns: list,
) -> pd.DataFrame:
    """
    Fetch specific columns for multiple banks in a single Parquet scan.
    Faster than N separate query_ratios calls — used by the Compare tab.
    Cached for 1 hour.
    """
    key = _ck("multi", tuple(sorted(rssd_ids)), quarter_date, tuple(sorted(columns)))
    hit = _cache_get(key)
    if hit is not None:
        return hit

    safe     = [c for c in columns if c.replace("_", "").isalnum()]
    col_expr = ", ".join(f'"{c}"' for c in ["rssd_id", "quarter_date"] + safe)
    ids_expr = ", ".join(f"'{r}'" for r in rssd_ids)
    url      = _parquet_url(quarter_date)

    con = _new_con()
    try:
        t0 = time.time()
        df = con.execute(f"""
            SELECT {col_expr}
            FROM read_parquet('{url}')
            WHERE rssd_id IN ({ids_expr})
        """).df()
        logger.info(
            f"query_multi_bank {quarter_date} "
            f"{len(rssd_ids)} banks -> {time.time()-t0:.2f}s"
        )
    finally:
        con.close()

    _cache_set(key, df)
    return df


def list_available_quarters() -> list:
    """
    List all ingested quarter_dates by scanning the R2 prefix hierarchy.
    Returns a sorted list e.g. ['20240331', '20240630', '20240930', ...].
    Cached for 1 hour — only changes when ingestion runs.
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

    quarters = []
    paginator = s3.get_paginator("list_objects_v2")

    for page in paginator.paginate(Bucket=BUCKET, Prefix="ubpr/year=", Delimiter="/"):
        for year_prefix in page.get("CommonPrefixes", []):
            for page2 in paginator.paginate(
                Bucket=BUCKET, Prefix=year_prefix["Prefix"], Delimiter="/"
            ):
                for q_prefix in page2.get("CommonPrefixes", []):
                    # e.g. "ubpr/year=2025/quarter=20251231/"
                    part  = q_prefix["Prefix"].rstrip("/").split("/")[-1]
                    qdate = part.replace("quarter=", "")
                    if qdate.isdigit() and len(qdate) == 8:
                        quarters.append(qdate)

    quarters = sorted(quarters)
    _cache_set(key, quarters)
    logger.info(f"list_available_quarters -> {len(quarters)} quarters: {quarters[:4]}")
    return quarters


# ── Health check ───────────────────────────────────────────────────────────────

def ping_r2() -> dict:
    """Quick connectivity check — does not read any data rows."""
    try:
        quarters = list_available_quarters()
        return {
            "status": "ok",
            "quarters_available": len(quarters),
            "latest": quarters[-1] if quarters else None,
        }
    except Exception as e:
        return {"status": "error", "detail": str(e)}