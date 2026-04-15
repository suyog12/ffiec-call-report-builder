import logging
from typing import TYPE_CHECKING
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from app.services.ubpr_service import UBPRService

REGULATORY_THRESHOLDS = {
    "CET1 Ratio":     {"well": 8.0,  "adequate": 6.0, "min": 4.5},
    "Tier 1 Capital": {"well": 10.0, "adequate": 8.0, "min": 6.0},
    "Total Capital":  {"well": 10.0, "adequate": 8.0, "min": 8.0},
    "Leverage Ratio": {"well": 5.0,  "adequate": 4.0, "min": 4.0},
}

CAPITAL_RATIO_CODES = {
    "UBPRD487": "CET1 Ratio",
    "UBPRR031": "CET1 Ratio",
    "UBPRD488": "Total Capital",
    "UBPRD486": "Leverage Ratio",
}


def _svc() -> "UBPRService":
    from app.services.ubpr_service import UBPRService  # noqa: PLC0415
    return UBPRService()


@tool
def get_ubpr_ratios(rssd_id: str, quarter_date: str) -> str:
    """
    Fetch key UBPR financial ratios for a bank and quarter.

    Args:
        rssd_id: Bank RSSD ID (e.g. "480228")
        quarter_date: Quarter in YYYYMMDD format (e.g. "20251231")

    Returns:
        Top 15 ratio code/value pairs for the bank and quarter.
    """
    try:
        data = _svc().get_key_ratios(rssd_id, quarter_date)
        ratios = {k: v for k, v in data.get("ratios", {}).items() if v is not None}
        if not ratios:
            return f"No UBPR ratio data found for RSSD {rssd_id} in quarter {quarter_date}."
        lines = [f"UBPR Ratios — RSSD {rssd_id} ({quarter_date}):"]
        for code, value in list(ratios.items())[:15]:
            lines.append(f"  {code}: {value}")
        return "\n".join(lines)
    except Exception as exc:
        logger.exception("Unexpected error in get_ubpr_ratios")
        return f"Error fetching UBPR ratios: {exc}"


@tool
def get_peer_comparison(rssd_id: str, quarter_date: str, peer_group: str = "all") -> str:
    """
    Compare a bank's UBPR ratios against peer group averages.

    Args:
        rssd_id: Bank RSSD ID
        quarter_date: Quarter in YYYYMMDD format
        peer_group: "all", "large", "mid", "community", "small"

    Returns:
        Table of bank value vs peer average and difference for top 12 metrics.
    """
    try:
        data = _svc().get_peer_comparison(rssd_id, quarter_date, peer_group)
        bank_vals = data.get("bank_ratios", {})
        peer_avgs = data.get("peer_averages", {})
        if not peer_avgs:
            return "No peer comparison data available."
        lines = [
            f"Peer Comparison ({peer_group}) — RSSD {rssd_id} ({quarter_date}):",
            f"{'Metric':<28} {'Bank':>10} {'Peer Avg':>10} {'Diff':>10}",
        ]
        for code in list(peer_avgs.keys())[:12]:
            bv = bank_vals.get(code)
            pv = peer_avgs.get(code)
            if bv is None or pv is None:
                continue
            try:
                diff = float(bv) - float(pv)
                lines.append(f"  {code:<26} {float(bv):>10.2f} {float(pv):>10.2f} {diff:>+10.2f}")
            except (TypeError, ValueError):
                pass
        return "\n".join(lines)
    except Exception as exc:
        logger.exception("Unexpected error in get_peer_comparison")
        return f"Error fetching peer comparison: {exc}"


@tool
def get_ubpr_trend(rssd_id: str, from_quarter: str, to_quarter: str, codes: str) -> str:
    """
    Fetch trend data for specific UBPR metric codes over a date range.

    Args:
        rssd_id: Bank RSSD ID
        from_quarter: Start quarter in YYYYMMDD format
        to_quarter: End quarter in YYYYMMDD format
        codes: Comma-separated UBPR codes e.g. "UBPRE013,UBPRE018"

    Returns:
        Quarterly values for each requested metric across the date range.
    """
    try:
        svc = _svc()
        code_list = [c.strip() for c in codes.split(",") if c.strip()]
        all_quarters = svc.get_available_quarters()
        data = svc.get_trend_data(rssd_id, from_quarter, to_quarter, all_quarters, code_list)
        trend = data.get("trend", [])
        if not trend:
            return "No trend data available for the specified range."
        by_code: dict = {}
        for row in trend:
            qd = row.get("quarter_date", "")
            for code in code_list:
                val = row.get(code)
                if val is not None:
                    by_code.setdefault(code, []).append((qd, val))
        lines = [f"UBPR Trend — RSSD {rssd_id} ({from_quarter} to {to_quarter}):"]
        for code, points in by_code.items():
            lines.append(f"\n  {code}:")
            for qd, val in sorted(points, reverse=True):
                lines.append(f"    {qd}: {val}")
        return "\n".join(lines)
    except Exception as exc:
        logger.exception("Unexpected error in get_ubpr_trend")
        return f"Error fetching UBPR trend: {exc}"


@tool
def flag_regulatory_issues(rssd_id: str, quarter_date: str) -> str:
    """
    Check a bank's capital ratios against Basel III regulatory thresholds.

    Args:
        rssd_id: Bank RSSD ID
        quarter_date: Quarter in YYYYMMDD format

    Returns:
        Regulatory status for each capital ratio with threshold comparisons.
    """
    try:
        data = _svc().get_key_ratios(rssd_id, quarter_date)
        ratios = data.get("ratios", {})
        lines = [f"Regulatory Status — RSSD {rssd_id} ({quarter_date}):"]
        found = False
        for code, label in CAPITAL_RATIO_CODES.items():
            val = ratios.get(code)
            if val is None:
                continue
            found = True
            thresholds = REGULATORY_THRESHOLDS[label]
            v = float(val)
            if v >= thresholds["well"]:
                status = "WELL-CAPITALIZED"
            elif v >= thresholds["adequate"]:
                status = "ADEQUATELY CAPITALIZED"
            else:
                status = "UNDERCAPITALIZED"
            lines.append(
                f"  {label} ({code}): {v:.2f}% — {status} "
                f"(min: {thresholds['min']}%, well-cap: {thresholds['well']}%)"
            )
        if not found:
            lines.append("  No capital ratio data found for this bank/quarter.")
        return "\n".join(lines)
    except Exception as exc:
        logger.exception("Unexpected error in flag_regulatory_issues")
        return f"Error checking regulatory status: {exc}"