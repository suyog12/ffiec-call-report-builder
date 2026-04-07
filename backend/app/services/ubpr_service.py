"""
ubpr_service.py
===============

Responsibilities
----------------
- Translate raw Parquet data into structured API responses
- Apply business rules (priority ratio selection, peer comparison)
- Provide graceful degradation — every method returns a valid response
- Warm in-process column cache to avoid repeated R2 reads

Performance
-----------
- Trend fetches run in parallel via ThreadPoolExecutor
- Column cache avoids repeated full-file scans for known banks
- bank_has_data() used as guard before every query
"""

from __future__ import annotations

import logging
from datetime import date
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

from queryengine.query_engine import (
    query_all_columns,
    query_ratios,
    query_peer_averages,
    query_multi_bank,
    list_available_quarters,
    bank_has_data as _bank_has_data,
    cache_clear as _cache_clear,
)

# Constants
_META_COLS = {"rssd_id", "quarter_date"}

# Ratio codes used for peer comparison
_PEER_CODES: list[str] = [
    "UBPRE013",  # Return on Assets
    "UBPRE018",  # Net Interest Margin
    "UBPRD487",  # CET1 Ratio (standardized)
    "UBPRD486",  # Leverage Ratio
    "UBPRD488",  # Total Capital Ratio
    "UBPR7308",  # Equity to Assets
    "UBPR7414",  # Non-Performing Loans
    "UBPRE019",  # Net Charge-Off Rate
    "UBPRE600",  # Loan to Deposit Ratio
    "UBPRR031",  # CET1 Ratio (risk-based)
]

# Priority groups for Executive Summary — one ratio per group shown
# First available code in each group is selected
_PRIORITY_GROUPS: list[list[str]] = [
    ["UBPRR031", "UBPRD487", "UBPR7400"],   # CET1
    ["UBPRD488", "UBPRR033"],               # Total Capital
    ["UBPRD486", "UBPR7408"],               # Leverage
    ["UBPR7308"],                           # Equity/Assets
    ["UBPRE013", "UBPRE012"],               # ROA
    ["UBPRE630"],                           # ROE
    ["UBPRE018", "UBPRE003"],               # NIM
    ["UBPRE600", "UBPR7316"],               # Loan/Deposit
    ["UBPR7414"],                           # NPL
    ["UBPRE019"],                           # Charge-off
]

# In-process column cache: rssd_id → list of non-null column codes
# Avoids repeated full-file scans for the same bank
_column_cache: dict[str, list[str]] = {}


# Helpers
def _is_valid_ratio(val: Any) -> bool:
    """Return True if val is a non-zero, parseable numeric value."""
    if val is None:
        return False
    s = str(val).strip()
    if s in ("", "0", "0000", "None", "nan", "NaN", "null", "NaT"):
        return False
    try:
        float(s)
        return True
    except (ValueError, TypeError):
        return False


def _pick_priority_ratios(available: set[str]) -> list[str]:
    """Select one ratio per priority group — returns up to 10 codes."""
    result = []
    for group in _PRIORITY_GROUPS:
        for code in group:
            if code in available:
                result.append(code)
                break
    return result


def _safe_float(val: Any) -> float | None:
    """Safely convert value to float. Returns None on failure."""
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


# Service class

class UBPRService:
    """
    Business logic layer for UBPR financial data.
    All public methods return structured dicts — never raise unhandled exceptions.
    """

    # Availability

    def bank_has_data(self, rssd_id: str, quarter_date: str) -> bool:
        """
        Check whether a bank has UBPR data for a given quarter.
        Used as a guard before any data fetch — avoids empty chart states.
        """
        try:
            return _bank_has_data(rssd_id, quarter_date)
        except Exception as e:
            logger.warning(f"bank_has_data check failed [{rssd_id} {quarter_date}]: {e}")
            return False

    def clear_cache(self) -> None:
        """Flush in-process caches. Called after new ingestion runs."""
        _column_cache.clear()
        _cache_clear()
        logger.info("UBPR service cache cleared.")

    # Quarter discovery

    def get_available_quarters(self) -> list[str]:
        """
        Return all quarters stored in R2 (source of truth).
        Falls back to generated date list if R2 is unreachable.
        """
        try:
            quarters = list_available_quarters()
            if quarters:
                return quarters
            logger.warning("R2 returned empty quarter list — using fallback")
        except Exception as e:
            logger.warning(f"R2 unreachable for quarter listing: {e}")

        return self._fallback_quarters()

    def _fallback_quarters(self) -> list[str]:
        """
        Generate last 8 quarters from today's date.
        Used only when R2 is unreachable — ensures API never returns empty.
        """
        quarter_ends = {1: "0331", 2: "0630", 3: "0930", 4: "1231"}
        today        = date.today()
        q            = (today.month - 1) // 3 + 1
        year         = today.year
        # Step back one quarter — FFIEC data lags quarter end by ~45 days
        q -= 1
        if q == 0:
            q    = 4
            year -= 1
        dates = []
        for _ in range(8):
            dates.append(f"{year}{quarter_ends[q]}")
            q -= 1
            if q == 0:
                q    = 4
                year -= 1
        return sorted(dates)

    # Key ratios (Executive Summary)

    def get_key_ratios(self, rssd_id: str, quarter_date: str) -> dict:
        """
        Fetch all non-null UBPR ratios for one bank × one quarter.
        Returns top-10 priority ratios for Executive Summary display.

        Response shape:
        {
            rssd_id, quarter_date,
            ratios: { "UBPR1234": 0.0847, ... },
            top10:  ["UBPRR031", "UBPRD488", ...]   # priority-ordered codes
        }
        """
        empty = {
            "rssd_id":      rssd_id,
            "quarter_date": quarter_date,
            "ratios":       {},
            "top10":        [],
        }

        try:
            df = query_all_columns(rssd_id, quarter_date)
        except Exception as e:
            logger.error(f"get_key_ratios query failed [{rssd_id} {quarter_date}]: {e}")
            return empty

        if df.empty:
            return empty

        try:
            row    = df.iloc[0].to_dict()
            ratios = {
                k: _safe_float(v)
                for k, v in row.items()
                if k not in _META_COLS and _is_valid_ratio(v)
            }
            # Remove None values from ratios
            ratios = {k: v for k, v in ratios.items() if v is not None}

            # Warm column cache
            if rssd_id not in _column_cache:
                _column_cache[rssd_id] = [str(k) for k in ratios.keys()]

            top10 = _pick_priority_ratios({str(k) for k in ratios.keys()})

            return {
                "rssd_id":      rssd_id,
                "quarter_date": quarter_date,
                "ratios":       ratios,
                "top10":        top10,
            }
        except Exception as e:
            logger.error(f"get_key_ratios processing failed [{rssd_id} {quarter_date}]: {e}")
            return empty

    # Trend data

    def get_trend_data(
        self,
        rssd_id: str,
        from_quarter: str,
        to_quarter: str,
        all_quarters: list[str],
        codes: list[str],
    ) -> dict:
        """
        Fetch ratio trend across a quarter range for one bank.

        Fetches only requested codes per quarter (columnar pushdown).
        Quarters are fetched in parallel for speed.
        Silently skips quarters where the bank has no data.

        Response shape:
        {
            rssd_id, from_quarter, to_quarter,
            quarters: [...],         # all quarters in range
            trend:    [{rssd_id, quarter_date, UBPR1234: 0.08, ...}, ...]
        }
        """
        empty = {
            "rssd_id":      rssd_id,
            "from_quarter": from_quarter,
            "to_quarter":   to_quarter,
            "quarters":     [],
            "trend":        [],
        }

        if not codes:
            return empty

        # Normalize quarter range
        start = min(from_quarter, to_quarter)
        end   = max(from_quarter, to_quarter)

        in_range = sorted(
            [q for q in all_quarters if start <= q <= end],
            reverse=True,
        )

        if not in_range:
            return empty

        logger.info(
            f"get_trend_data {rssd_id} codes={codes} "
            f"range={start}→{end} quarters={len(in_range)}"
        )

        frames: list[pd.DataFrame] = []

        with ThreadPoolExecutor(max_workers=6) as pool:
            future_map = {
                pool.submit(query_ratios, rssd_id, qd, codes): qd
                for qd in in_range
            }
            for future in as_completed(future_map):
                qd = future_map[future]
                try:
                    df = future.result()
                    if df is not None and not df.empty:
                        frames.append(df)
                        logger.debug(f"trend quarter={qd} rows={len(df)}")
                    else:
                        logger.debug(f"trend quarter={qd} empty — bank may not have filed")
                except Exception as e:
                    logger.warning(f"trend quarter={qd} failed: {e}")

        logger.info(
            f"get_trend_data {rssd_id}: "
            f"{len(frames)}/{len(in_range)} quarters returned data"
        )

        if not frames:
            return {**empty, "quarters": in_range}

        result = (
            pd.concat(frames, ignore_index=True)
            .sort_values("quarter_date", ascending=False)
        )

        return {
            "rssd_id":      rssd_id,
            "from_quarter": from_quarter,
            "to_quarter":   to_quarter,
            "quarters":     in_range,
            "trend":        result.to_dict(orient="records"),
        }

    # Peer comparison

    def get_peer_comparison(
        self,
        rssd_id: str,
        quarter_date: str,
        peer_group: str = "all",
    ) -> dict:
        """
        Compare one bank's ratios against peer group averages.

        Response shape:
        {
            rssd_id, quarter_date, peer_group,
            bank_ratios:   { "UBPR1234": 0.0847, ... },
            peer_averages: { "UBPR1234": 0.0712, ... },
            deltas:        { "UBPR1234": 0.0135, ... }  # bank - peer
        }
        """
        empty = {
            "rssd_id":       rssd_id,
            "quarter_date":  quarter_date,
            "peer_group":    peer_group,
            "bank_ratios":   {},
            "peer_averages": {},
            "deltas":        {},
        }

        bank_ratios: dict[str, float]   = {}
        peer_averages: dict[str, float] = {}

        # Fetch bank ratios
        try:
            df = query_all_columns(rssd_id, quarter_date)
            if not df.empty:
                row        = df.iloc[0].to_dict()
                bank_ratios = {
                    str(k): v for k, v in {
                        k: _safe_float(v)
                        for k, v in row.items()
                        if k not in _META_COLS and _is_valid_ratio(v)
                    }.items()
                    if v is not None
                }
                if rssd_id not in _column_cache:
                    _column_cache[rssd_id] = list(bank_ratios.keys())
        except Exception as e:
            logger.error(f"get_peer_comparison bank fetch failed [{rssd_id}]: {e}")

        # Fetch peer averages for codes present in bank data
        peer_codes = [c for c in _PEER_CODES if c in bank_ratios]
        if peer_codes:
            try:
                df = query_peer_averages(quarter_date, peer_codes)
                if not df.empty:
                    row = df.iloc[0].to_dict()
                    peer_averages = {
                        str(k): v for k, v in {
                            k: _safe_float(v)
                            for k, v in row.items()
                        }.items()
                        if v is not None
                    }
            except Exception as e:
                logger.error(
                    f"get_peer_comparison peer averages failed [{quarter_date}]: {e}"
                )

        # Compute deltas (bank - peer)
        deltas = {
            k: round(bank_ratios[k] - peer_averages[k], 6)
            for k in bank_ratios
            if k in peer_averages
        }

        return {
            "rssd_id":       rssd_id,
            "quarter_date":  quarter_date,
            "peer_group":    peer_group,
            "bank_ratios":   bank_ratios,
            "peer_averages": peer_averages,
            "deltas":        deltas,
        }

    # All fields (custom ratio builder)

    def get_all_fields(self, rssd_id: str, quarter_date: str) -> dict:
        """
        Fetch every UBPR field for one bank × one quarter.
        Used by the custom ratio builder tab.

        Response shape:
        {
            rssd_id, quarter_date,
            total_fields: 2808,
            fields: { "UBPR1234": 0.08, ... }
        }
        """
        empty = {
            "rssd_id":      rssd_id,
            "quarter_date": quarter_date,
            "total_fields": 0,
            "fields":       {},
        }

        try:
            df = query_all_columns(rssd_id, quarter_date)
        except Exception as e:
            logger.error(f"get_all_fields query failed [{rssd_id} {quarter_date}]: {e}")
            return empty

        if df.empty:
            return empty

        try:
            row = df.iloc[0].to_dict()
            return {
                "rssd_id":      rssd_id,
                "quarter_date": quarter_date,
                "total_fields": len(row),
                "fields":       row,
            }
        except Exception as e:
            logger.error(f"get_all_fields processing failed: {e}")
            return empty