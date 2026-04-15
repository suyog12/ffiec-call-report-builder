import asyncio
import logging
from typing import TYPE_CHECKING
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from app.services.report_service import ReportService
    from app.services.period_service import PeriodService


def _report_svc() -> "ReportService":
    from app.services.report_service import ReportService  # noqa: PLC0415
    return ReportService()


def _period_svc() -> "PeriodService":
    from app.services.period_service import PeriodService  # noqa: PLC0415
    return PeriodService()


def _run(coro):
    """Run an async coroutine safely from a sync context inside FastAPI."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures  # noqa: PLC0415
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                return pool.submit(asyncio.run, coro).result()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


def _fmt(v) -> str:
    if v is None:
        return "N/A"
    try:
        n = float(v)
        if abs(n) >= 1e12: return f"${n/1e12:.2f}T"
        if abs(n) >= 1e9:  return f"${n/1e9:.2f}B"
        if abs(n) >= 1e6:  return f"${n/1e6:.2f}M"
        return f"${n:,.0f}"
    except (TypeError, ValueError):
        return str(v)


@tool
def get_available_periods() -> str:
    """
    Fetch all available FFIEC Call Report reporting periods.

    Returns:
        List of available quarter-end dates in MM/DD/YYYY format, most recent first.
    """
    try:
        periods = _run(_period_svc().get_periods())
        if isinstance(periods, list):
            return f"Available periods ({len(periods)} total): " + ", ".join(periods[:12])
        return str(periods)
    except Exception as exc:
        logger.exception("Unexpected error in get_available_periods")
        return f"Error fetching periods: {exc}"


@tool
def get_bank_metrics(rssd_id: str, reporting_period: str) -> str:
    """
    Fetch key financial metrics for a bank from their Call Report filing.

    Args:
        rssd_id: Bank RSSD ID (e.g. "480228")
        reporting_period: Period in MM/DD/YYYY format (e.g. "12/31/2025")

    Returns:
        Key metrics including total assets, loans, deposits, equity, net income.
    """
    try:
        svc = _report_svc()
        data = _run(svc.get_sdf_report(int(rssd_id), reporting_period))
        metrics = svc.build_metrics(data["all_rows"])
        if not metrics:
            return f"No metrics found for RSSD {rssd_id} for period {reporting_period}."
        lines = [f"Call Report Metrics — RSSD {rssd_id} ({reporting_period}):"]
        for key, val in metrics.items():
            lines.append(f"  {key.replace('_', ' ').title()}: {_fmt(val)}")
        return "\n".join(lines)
    except Exception as exc:
        logger.exception("Unexpected error in get_bank_metrics")
        return f"Error fetching metrics: {exc}"


@tool
def get_schedule_data(rssd_id: str, reporting_period: str, schedules: str = "RC,RI") -> str:
    """
    Fetch specific Call Report schedule data for a bank.

    Args:
        rssd_id: Bank RSSD ID
        reporting_period: Period in MM/DD/YYYY format
        schedules: Comma-separated schedule codes e.g. "RC,RI,RC-C"

    Returns:
        Top 10 line items per schedule with item codes, descriptions, and values.
    """
    try:
        svc = _report_svc()
        schedule_list = [s.strip() for s in schedules.split(",") if s.strip()]
        data = _run(svc.get_selected_sections(int(rssd_id), reporting_period, schedule_list))
        sections = data.get("sections", {})
        if not sections:
            return f"No schedule data found for schedules: {schedules}."
        lines = [f"Schedule Data — RSSD {rssd_id} ({reporting_period}):"]
        for sec, rows in sections.items():
            lines.append(f"\n  Schedule {sec} ({len(rows)} items):")
            for row in rows[:10]:
                code = row.get("item_code", "")
                desc = row.get("description", "")[:48]
                val  = row.get("value", "")
                lines.append(f"    {code:<12} {desc:<50} {val}")
            if len(rows) > 10:
                lines.append(f"    ... and {len(rows) - 10} more rows")
        return "\n".join(lines)
    except Exception as exc:
        logger.exception("Unexpected error in get_schedule_data")
        return f"Error fetching schedule data: {exc}"


@tool
def get_available_schedules(rssd_id: str, reporting_period: str) -> str:
    """
    List all schedules available in a bank's Call Report filing.

    Args:
        rssd_id: Bank RSSD ID
        reporting_period: Period in MM/DD/YYYY format

    Returns:
        List of schedule codes present in this bank's filing.
    """
    try:
        data = _run(_report_svc().get_sdf_report(int(rssd_id), reporting_period))
        sections = data.get("available_sections", [])
        return f"Available schedules — RSSD {rssd_id} ({reporting_period}): {', '.join(sections)}"
    except Exception as exc:
        logger.exception("Unexpected error in get_available_schedules")
        return f"Error fetching schedules: {exc}"