"""
ubpr_tools.py

Custom LangChain tools for UBPR Financial Analysis.
Each tool calls the deployed FFIEC backend API.

Tools:
    - get_ubpr_ratios        : Fetch key ratios for a bank/quarter
    - get_peer_comparison    : Compare bank vs peer group averages
    - get_ubpr_trend         : Fetch trend data for specific metrics
    - flag_regulatory_issues : Check ratios against regulatory thresholds
"""

import os
import requests
from langchain_core.tools import tool

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")

REGULATORY_MINIMUMS = {
    "CET1 Ratio":      {"well": 8.0,  "adequate": 6.0,  "min": 4.5},
    "Tier 1 Capital":  {"well": 10.0, "adequate": 8.0,  "min": 6.0},
    "Total Capital":   {"well": 10.0, "adequate": 8.0,  "min": 8.0},
    "Leverage Ratio":  {"well": 5.0,  "adequate": 4.0,  "min": 4.0},
}


@tool
def get_ubpr_ratios(rssd_id: str, quarter_date: str) -> str:
    """
    Fetch key UBPR financial ratios for a specific bank and quarter.

    Args:
        rssd_id: The bank's RSSD ID (e.g. "480228" for Bank of America)
        quarter_date: Quarter in YYYYMMDD format (e.g. "20251231" for Q4 2025)

    Returns:
        JSON string containing ratio names, values, and categories
    """
    try:
        resp = requests.get(
            f"{BACKEND_URL}/ubpr/ratios",
            params={"rssd_id": rssd_id, "quarter_date": quarter_date},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        ratios = data.get("ratios", {})
        if not ratios:
            return f"No UBPR ratio data found for RSSD {rssd_id} in quarter {quarter_date}."
        lines = [f"UBPR Ratios for RSSD {rssd_id} ({quarter_date}):"]
        for code, value in list(ratios.items())[:20]:
            if value is not None:
                lines.append(f"  {code}: {value}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error fetching UBPR ratios: {str(e)}"


@tool
def get_peer_comparison(rssd_id: str, quarter_date: str, peer_group: str = "all") -> str:
    """
    Compare a bank's UBPR ratios against its peer group averages.

    Args:
        rssd_id: The bank's RSSD ID
        quarter_date: Quarter in YYYYMMDD format
        peer_group: Size group — "all", "large" (>$100B), "mid" ($10B-$100B),
                    "community" (<$10B), "small" (<$1B)

    Returns:
        Comparison table showing bank value vs peer average and difference
    """
    try:
        resp = requests.get(
            f"{BACKEND_URL}/ubpr/peer-comparison",
            params={"rssd_id": rssd_id, "quarter_date": quarter_date, "peer_group": peer_group},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        bank_vals = data.get("bank_ratios", {})
        peer_avgs = data.get("peer_averages", {})
        if not peer_avgs:
            return "No peer comparison data available."
        lines = [f"Peer Comparison ({peer_group} banks) for RSSD {rssd_id} ({quarter_date}):"]
        lines.append(f"{'Metric':<30} {'Bank':>10} {'Peer Avg':>10} {'Diff':>10}")
        lines.append("-" * 65)
        for code in list(peer_avgs.keys())[:15]:
            bv = bank_vals.get(code)
            pv = peer_avgs.get(code)
            if bv is not None and pv is not None:
                try:
                    diff = float(bv) - float(pv)
                    lines.append(f"  {code:<28} {float(bv):>10.2f} {float(pv):>10.2f} {diff:>+10.2f}")
                except Exception:
                    pass
        return "\n".join(lines)
    except Exception as e:
        return f"Error fetching peer comparison: {str(e)}"


@tool
def get_ubpr_trend(rssd_id: str, from_quarter: str, to_quarter: str, codes: str) -> str:
    """
    Fetch trend data for specific UBPR metric codes over a date range.

    Args:
        rssd_id: The bank's RSSD ID
        from_quarter: Start quarter in YYYYMMDD format
        to_quarter: End quarter in YYYYMMDD format
        codes: Comma-separated UBPR codes e.g. "UBPRE013,UBPRE018"

    Returns:
        Trend data showing values across quarters for each requested metric
    """
    try:
        code_list = [c.strip() for c in codes.split(",")]
        resp = requests.get(
            f"{BACKEND_URL}/ubpr/trend",
            params={
                "rssd_id": rssd_id,
                "from_quarter": from_quarter,
                "to_quarter": to_quarter,
                "codes": code_list,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        if not data:
            return "No trend data available for the specified range."
        lines = [f"UBPR Trend for RSSD {rssd_id} ({from_quarter} to {to_quarter}):"]
        for code, points in data.items():
            lines.append(f"\n  {code}:")
            for p in points:
                lines.append(f"    {p.get('quarter', '')}: {p.get('value', 'N/A')}")
        return "\n".join(lines)
    except Exception as e:
        return f"Error fetching UBPR trend: {str(e)}"


@tool
def flag_regulatory_issues(rssd_id: str, quarter_date: str) -> str:
    """
    Check a bank's capital ratios against regulatory thresholds and flag any issues.

    Args:
        rssd_id: The bank's RSSD ID
        quarter_date: Quarter in YYYYMMDD format

    Returns:
        Regulatory status for each capital ratio with threshold comparisons
    """
    try:
        resp = requests.get(
            f"{BACKEND_URL}/ubpr/ratios",
            params={"rssd_id": rssd_id, "quarter_date": quarter_date},
            timeout=30,
        )
        resp.raise_for_status()
        ratios = resp.json().get("ratios", {})

        checks = {
            "UBPRD487": ("CET1 Ratio",     REGULATORY_MINIMUMS["CET1 Ratio"]),
            "UBPRR031": ("CET1 Ratio",     REGULATORY_MINIMUMS["CET1 Ratio"]),
            "UBPRD488": ("Total Capital",  REGULATORY_MINIMUMS["Total Capital"]),
            "UBPRD486": ("Leverage Ratio", REGULATORY_MINIMUMS["Leverage Ratio"]),
        }

        lines = [f"Regulatory Status for RSSD {rssd_id} ({quarter_date}):"]
        found_any = False
        for code, (name, thresholds) in checks.items():
            val = ratios.get(code)
            if val is None:
                continue
            found_any = True
            v = float(val)
            if v >= thresholds["well"]:
                status = "WELL-CAPITALIZED"
            elif v >= thresholds["adequate"]:
                status = " ADEQUATELY CAPITALIZED"
            else:
                status = "🚨 UNDERCAPITALIZED"
            lines.append(
                f"  {name} ({code}): {v:.2f}% — {status} "
                f"(min: {thresholds['min']}%, well-cap: {thresholds['well']}%)"
            )

        if not found_any:
            lines.append("  No capital ratio data found for this bank/quarter.")
        return "\n".join(lines)
    except Exception as e:
        return f"Error checking regulatory status: {str(e)}"
