import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Intent → tool mapping
# ---------------------------------------------------------------------------

_SCHEDULE_KEYWORDS = frozenset([
    "schedule", "rc-c", "rc-b", "rc-r", "ri-a", "ri-b",
    "schedule rc", "schedule ri", "line item", "section",
])
_METRICS_KEYWORDS = frozenset([
    "total assets", "total loans", "total deposits", "net income",
    "equity", "metrics", "key figures", "financial summary", "overview",
    "assets", "loans", "deposits",
])
_PERIODS_KEYWORDS = frozenset([
    "available periods", "what periods", "which quarters", "all periods",
    "what dates", "filing dates",
])
_SCHEDULES_LIST_KEYWORDS = frozenset([
    "available schedules", "which schedules", "what schedules", "list schedules",
])

_PERIOD_KEYWORDS = frozenset([
    "quarter", "q1", "q2", "q3", "q4",
    "2023", "2024", "2025", "2026",
    "january", "march", "june", "september", "december",
    "last", "this", "recent",
])


def _classify(question: str) -> str:
    """Return 'periods' | 'schedules_list' | 'schedule' | 'metrics'."""
    q = question.lower()
    if any(kw in q for kw in _PERIODS_KEYWORDS):
        return "periods"
    if any(kw in q for kw in _SCHEDULES_LIST_KEYWORDS):
        return "schedules_list"
    if any(kw in q for kw in _SCHEDULE_KEYWORDS):
        return "schedule"
    return "metrics"


def _extract_schedules(question: str) -> str:
    """Pull schedule codes from the question or return defaults."""
    import re
    # Match patterns like RC-C, RI, RC, RC-B etc.
    codes = re.findall(r"\bRC(?:-[A-Z]+)?\b|\bRI(?:-[A-Z]+)?\b", question.upper())
    return ",".join(dict.fromkeys(codes)) if codes else "RC,RI"


def run_call_report_agent(
    question: str,
    rssd_id: Optional[str] = None,
    bank_name: Optional[str] = None,
    period: Optional[str] = None,
    available_periods: Optional[list] = None,
    thread_id: str = "default",
    stream: bool = False,
) -> str:
    """
    Answer Call Report questions by dispatching directly to the appropriate tool.
    No LLM call is made — the tool output is returned as-is.
    """
    from tools.call_report_tools import (  # noqa: PLC0415
        get_available_periods,
        get_bank_metrics,
        get_schedule_data,
        get_available_schedules,
    )

    intent = _classify(question)
    logger.debug("Call Report direct dispatch: intent=%s rssd=%s period=%s", intent, rssd_id, period)

    # Periods list doesn't need rssd_id
    if intent == "periods":
        return get_available_periods.invoke({})  # type: ignore[attr-defined]

    # Everything else needs rssd_id + period
    if not rssd_id:
        return (
            "No bank is currently selected. "
            "Please select a bank in the dashboard before asking Call Report questions."
        )

    # Resolve period from question if necessary
    resolved_period = period
    resolution_note = ""
    if available_periods and any(kw in question.lower() for kw in _PERIOD_KEYWORDS):
        from tools.period_resolver import resolve_period  # noqa: PLC0415
        resolved = resolve_period(question, available_periods)
        resolved_period = resolved["ffiec"]
        if not resolved["exact_match"] and resolved["nearest_match"]:
            resolution_note = (
                f"\n[Note: Exact period not available. "
                f"Nearest available: {resolved['nearest_match']}]"
            )

    if not resolved_period:
        return (
            "No reporting period is currently selected. "
            "Please select a period in the dashboard."
        )

    if intent == "schedules_list":
        return get_available_schedules.invoke(  # type: ignore[attr-defined]
            {"rssd_id": rssd_id, "reporting_period": resolved_period}
        ) + resolution_note

    if intent == "schedule":
        schedules = _extract_schedules(question)
        return get_schedule_data.invoke(  # type: ignore[attr-defined]
            {
                "rssd_id": rssd_id,
                "reporting_period": resolved_period,
                "schedules": schedules,
            }
        ) + resolution_note

    # Default: metrics
    return get_bank_metrics.invoke(  # type: ignore[attr-defined]
        {"rssd_id": rssd_id, "reporting_period": resolved_period}
    ) + resolution_note