import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Intent → tool mapping (no LLM needed for in-scope questions)
# ---------------------------------------------------------------------------

_TREND_KEYWORDS = frozenset([
    "trend", "over time", "history", "historical", "quarters", "quarter over",
    "change", "progression", "evolution",
])
_PEER_KEYWORDS = frozenset([
    "peer", "benchmark", "compare", "comparison", "industry", "average",
    "similar banks", "peer group",
])
_REGULATORY_KEYWORDS = frozenset([
    "regulatory", "well-capitalized", "adequately capitalized", "undercapitalized",
    "basel", "capital requirement", "capital adequacy", "compliant", "breach",
    "flag", "threshold",
])

# Default UBPR codes used when trend question doesn't specify
_DEFAULT_TREND_CODES = "UBPRE013,UBPRE018,UBPRD487,UBPRD486"


def _classify(question: str) -> str:
    """Return 'trend' | 'peer' | 'regulatory' | 'ratios'."""
    q = question.lower()
    if any(kw in q for kw in _TREND_KEYWORDS):
        return "trend"
    if any(kw in q for kw in _PEER_KEYWORDS):
        return "peer"
    if any(kw in q for kw in _REGULATORY_KEYWORDS):
        return "regulatory"
    return "ratios"


def _extract_codes(question: str) -> str:
    """Pull explicit UBPR codes from the question, fall back to defaults."""
    import re
    codes = re.findall(r"\bUBPR[A-Z]\d{3,}\b", question.upper())
    return ",".join(codes) if codes else _DEFAULT_TREND_CODES


def run_ubpr_agent(
    question: str,
    rssd_id: Optional[str] = None,
    bank_name: Optional[str] = None,
    quarter: Optional[str] = None,
    thread_id: str = "default",
    stream: bool = False,
) -> str:
    """
    Answer UBPR questions by dispatching directly to the appropriate tool.
    No LLM call is made — the tool output is returned as-is.

    Falls back to a Gemini-powered synthesis only when rssd_id / quarter are
    missing and the question cannot be answered without them.
    """
    # Guard: can't query data without identifiers
    if not rssd_id or not quarter:
        return (
            "No bank or quarter is currently selected. "
            "Please select a bank and quarter in the dashboard before asking UBPR questions."
        )

    # Lazy imports keep module load fast
    from tools.ubpr_tools import (  # noqa: PLC0415
        get_ubpr_ratios,
        get_peer_comparison,
        get_ubpr_trend,
        flag_regulatory_issues,
    )

    intent = _classify(question)
    logger.debug("UBPR direct dispatch: intent=%s rssd=%s quarter=%s", intent, rssd_id, quarter)

    if intent == "regulatory":
        return flag_regulatory_issues.invoke(  # type: ignore[attr-defined]
            {"rssd_id": rssd_id, "quarter_date": quarter}
        )

    if intent == "peer":
        # Detect peer group size hint from question
        q = question.lower()
        if "large" in q:
            peer_group = "large"
        elif "community" in q or "small" in q:
            peer_group = "community"
        elif "mid" in q:
            peer_group = "mid"
        else:
            peer_group = "all"
        return get_peer_comparison.invoke(  # type: ignore[attr-defined]
            {"rssd_id": rssd_id, "quarter_date": quarter, "peer_group": peer_group}
        )

    if intent == "trend":
        codes = _extract_codes(question)
        # Use last 8 quarters as default range when none specified
        from_quarter = _eight_quarters_back(quarter)
        return get_ubpr_trend.invoke(  # type: ignore[attr-defined]
            {
                "rssd_id": rssd_id,
                "from_quarter": from_quarter,
                "to_quarter": quarter,
                "codes": codes,
            }
        )

    # Default: fetch ratios
    return get_ubpr_ratios.invoke(  # type: ignore[attr-defined]
        {"rssd_id": rssd_id, "quarter_date": quarter}
    )


def _eight_quarters_back(quarter_yyyymmdd: str) -> str:
    """Return the quarter 8 quarters (2 years) before the given YYYYMMDD date."""
    try:
        from datetime import date, timedelta  # noqa: PLC0415
        y = int(quarter_yyyymmdd[:4])
        m = int(quarter_yyyymmdd[4:6])
        # Step back 2 years
        y -= 2
        return date(y, m, 1).strftime("%Y%m%d")
    except Exception:
        # Fallback: just use the same quarter (trend will be single point)
        return quarter_yyyymmdd