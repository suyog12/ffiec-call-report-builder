import logging
from datetime import date
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd

logger = logging.getLogger(__name__)

from queryengine.query_engine import (
    query_all_columns,
    query_ratios,
    query_peer_averages,
    query_multi_bank,
    list_available_quarters,
    bank_has_data as _qe_bank_has_data,
    cache_clear as _qe_cache_clear,
)

_META_COLS = {"rssd_id", "quarter_date"}

_PEER_CODES = [
    "UBPRE013",  # ROA
    "UBPRE018",  # NIM
    "UBPRD487",  # Tier 1 Risk-Based Capital %
    "UBPRD486",  # Leverage Ratio %
    "UBPRD488",  # Total Capital Ratio %
    "UBPR7308",  # Equity to Assets
    "UBPR7414",  # NPL
    "UBPRE019",  # Net Charge-Off Rate
    "UBPRE600",  # Loan to Deposit Ratio
]

PRIORITY_GROUPS = [
    ["UBPRR031", "UBPRD487", "UBPR7400"],
    ["UBPRD488", "UBPRR033"],
    ["UBPRD486", "UBPR7408"],
    ["UBPR7308"],
    ["UBPRE013", "UBPRE012"],
    ["UBPRE630"],
    ["UBPRE018", "UBPRE003"],
    ["UBPRE600", "UBPR7316"],
    ["UBPR7414"],
    ["UBPRE019"],
]

# Cache: rssd_id → list of non-null column codes
# Only used for Executive Summary / ratio discovery, not for trend
_column_cache: dict[str, list[str]] = {}


def _is_ratio_value(val) -> bool:
    if val is None:
        return False
    s = str(val).strip()
    if s in ("", "0000", "0", "None", "nan", "NaN", "null"):
        return False
    try:
        float(s)
        return True
    except (ValueError, TypeError):
        return False


def _pick_top10(available_codes: set) -> list:
    result = []
    for group in PRIORITY_GROUPS:
        for code in group:
            if code in available_codes:
                result.append(code)
                break
    return result


class UBPRService:

    def bank_has_data(self, rssd_id: str, quarter_date: str) -> bool:
        """Check if a bank has any data for a quarter before querying."""
        try:
            return _qe_bank_has_data(rssd_id, quarter_date)
        except Exception as e:
            logger.warning(f"bank_has_data check failed [{rssd_id} {quarter_date}]: {e}")
            return False

    def clear_cache(self) -> None:
        """Flush the in-process DuckDB query cache."""
        _column_cache.clear()
        _qe_cache_clear()
        logger.info("UBPR service cache cleared.")

    def get_key_ratios(self, rssd_id: str, quarter_date: str) -> dict:
        """All non-null UBPR fields for one bank in one quarter."""
        try:
            df = query_all_columns(rssd_id, quarter_date)
        except Exception as e:
            logger.error(f"query_all_columns failed [{rssd_id} {quarter_date}]: {e}")
            return {"rssd_id": rssd_id, "quarter_date": quarter_date, "ratios": {}}

        if df.empty:
            return {"rssd_id": rssd_id, "quarter_date": quarter_date, "ratios": {}}

        row = df.iloc[0].to_dict()
        ratios = {k: v for k, v in row.items() if k not in _META_COLS and _is_ratio_value(v)}

        # Warm the column cache while we have the data
        if rssd_id not in _column_cache:
            _column_cache[rssd_id] = [str(k) for k in ratios.keys()]

        return {"rssd_id": rssd_id, "quarter_date": quarter_date, "ratios": ratios}

    def get_trend_data(
        self,
        rssd_id: str,
        from_quarter: str,
        to_quarter: str,
        all_quarters: list[str],
        codes: list[str],
    ) -> dict:
        """
        Fetch trend data for specific metric codes across a quarter range.

        - codes: the exact UBPR column codes the user selected (e.g. ["UBPR7204"])
        - Fetches ONLY those columns per quarter — fast columnar pushdown
        - No column discovery step needed
        - query_ratios handles schema differences between quarters internally
        """
        quarter_dates = sorted(
            [q for q in all_quarters if from_quarter <= q <= to_quarter],
            reverse=True,
        )

        logger.info(
            f"[trend] rssd={rssd_id} codes={codes} "
            f"range={from_quarter}→{to_quarter} quarters={len(quarter_dates)}"
        )

        if not quarter_dates:
            return {"rssd_id": rssd_id, "trend": [], "quarters": []}

        if not codes:
            return {"rssd_id": rssd_id, "trend": [], "quarters": quarter_dates}

        # Parallel fetch — one small read per quarter, only requested columns
        frames = []
        with ThreadPoolExecutor(max_workers=6) as ex:
            futures = {
                ex.submit(query_ratios, rssd_id, qd, codes): qd
                for qd in quarter_dates
            }
            for f in as_completed(futures):
                qd = futures[f]
                try:
                    df = f.result()
                    if df is not None and not df.empty:
                        frames.append(df)
                        logger.info(f"[trend] quarter={qd} rows={len(df)}")
                    else:
                        logger.warning(f"[trend] quarter={qd} returned empty")
                except Exception as e:
                    logger.warning(f"[trend] quarter={qd} failed: {e}")

        logger.info(f"[trend] {len(frames)}/{len(quarter_dates)} quarters returned data")

        if not frames:
            return {"rssd_id": rssd_id, "trend": [], "quarters": quarter_dates}

        result = pd.concat(frames, ignore_index=True).sort_values(
            "quarter_date", ascending=False
        )

        return {
            "rssd_id": rssd_id,
            "from_quarter": from_quarter,
            "to_quarter": to_quarter,
            "quarters": quarter_dates,
            "trend": result.to_dict(orient="records"),
        }

    def get_peer_comparison(self, rssd_id: str, quarter_date: str, peer_group: str = "all") -> dict:
        bank_ratios = {}
        peer_averages = {}

        try:
            df = query_all_columns(rssd_id, quarter_date)
            if not df.empty:
                row = df.iloc[0].to_dict()
                bank_ratios = {k: v for k, v in row.items() if k not in _META_COLS and _is_ratio_value(v)}
                if rssd_id not in _column_cache:
                    _column_cache[rssd_id] = [str(k) for k in bank_ratios.keys()]
        except Exception as e:
            logger.error(f"Bank fetch failed [{rssd_id}]: {e}")

        peer_codes = [c for c in _PEER_CODES if c in bank_ratios]
        if peer_codes:
            try:
                df = query_peer_averages(quarter_date, peer_codes)
                if not df.empty:
                    row = df.iloc[0].to_dict()
                    peer_averages = {k: round(float(v), 6) for k, v in row.items() if v is not None}
            except Exception as e:
                logger.error(f"Peer averages failed [{quarter_date}]: {e}")

        return {
            "rssd_id": rssd_id,
            "quarter_date": quarter_date,
            "peer_group": peer_group,
            "bank_ratios": bank_ratios,
            "peer_averages": peer_averages,
        }

    def get_all_fields(self, rssd_id: str, quarter_date: str) -> dict:
        try:
            df = query_all_columns(rssd_id, quarter_date)
        except Exception as e:
            logger.error(f"query_all_columns failed [{rssd_id} {quarter_date}]: {e}")
            return {"rssd_id": rssd_id, "quarter_date": quarter_date, "fields": {}}
        if df.empty:
            return {"rssd_id": rssd_id, "quarter_date": quarter_date, "fields": {}}
        row = df.iloc[0].to_dict()
        return {"rssd_id": rssd_id, "quarter_date": quarter_date, "total_fields": len(row), "fields": row}

    def get_available_quarters(self) -> list:
        try:
            return list_available_quarters()
        except Exception as e:
            logger.warning(f"R2 unreachable, using fallback: {e}")
            return self._fallback_quarters()

    def _fallback_quarters(self) -> list:
        quarter_ends = {1: "0331", 2: "0630", 3: "0930", 4: "1231"}
        today = date.today()
        q = (today.month - 1) // 3 + 1
        year = today.year
        q -= 1
        if q == 0:
            q = 4
            year -= 1
        dates = []
        for _ in range(8):
            dates.append(f"{year}{quarter_ends[q]}")
            q -= 1
            if q == 0:
                q = 4
                year -= 1
        return sorted(dates)