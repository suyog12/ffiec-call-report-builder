import os
import logging
import requests
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT = 60


def _backend_url() -> str:
    return os.getenv("BACKEND_URL", "http://127.0.0.1:8000")


def _get(path: str, params: dict) -> dict:
    resp = requests.get(
        f"{_backend_url()}{path}",
        params=params,
        timeout=_REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def _fmt_dollars(v) -> str:
    if v is None:
        return "N/A"
    try:
        n = float(v)
        if abs(n) >= 1e12:
            return f"${n / 1e12:.2f}T"
        if abs(n) >= 1e9:
            return f"${n / 1e9:.2f}B"
        if abs(n) >= 1e6:
            return f"${n / 1e6:.2f}M"
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
        resp = requests.get(f"{_backend_url()}/periods/", timeout=15)
        resp.raise_for_status()
        periods = resp.json()
        if isinstance(periods, list):
            return f"Available periods ({len(periods)} total): " + ", ".join(periods[:12])
        return str(periods)
    except requests.exceptions.Timeout:
        logger.warning("Timeout fetching available periods")
        return "Request timed out fetching available periods."
    except requests.exceptions.HTTPError as exc:
        logger.error("HTTP %s fetching available periods", exc.response.status_code)
        return f"Backend returned {exc.response.status_code} fetching periods."
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
        Key metrics including total assets, loans, deposits, equity, net income,
        and computed ratios like equity-to-assets and loans-to-deposits.
    """
    try:
        data = _get("/reports/metrics", {"rssd_id": rssd_id, "reporting_period": reporting_period})
        metrics = data.get("metrics", {})
        if not metrics:
            return f"No metrics found for RSSD {rssd_id} for period {reporting_period}."
        lines = [f"Call Report Metrics — RSSD {rssd_id} ({reporting_period}):"]
        for key, val in metrics.items():
            lines.append(f"  {key.replace('_', ' ').title()}: {_fmt_dollars(val)}")
        return "\n".join(lines)
    except requests.exceptions.Timeout:
        logger.warning("Timeout fetching metrics for RSSD %s", rssd_id)
        return f"Request timed out fetching metrics for RSSD {rssd_id}."
    except requests.exceptions.HTTPError as exc:
        status = exc.response.status_code
        if status == 404:
            return f"No Call Report filing found for RSSD {rssd_id} for period {reporting_period}."
        logger.error("HTTP %s fetching metrics for RSSD %s", status, rssd_id)
        return f"Backend returned {status} for RSSD {rssd_id} ({reporting_period})."
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
                   RC = Balance Sheet, RI = Income Statement, RC-C = Loans

    Returns:
        Top 10 line items per schedule with item codes, descriptions, and values.
    """
    try:
        schedule_list = [s.strip() for s in schedules.split(",") if s.strip()]
        data = _get(
            "/reports/section-data",
            {
                "rssd_id": rssd_id,
                "reporting_period": reporting_period,
                "sections": schedule_list,
            },
        )
        sections = data.get("sections", {})
        if not sections:
            return f"No schedule data found for schedules: {schedules}."
        lines = [f"Schedule Data — RSSD {rssd_id} ({reporting_period}):"]
        for sec, rows in sections.items():
            lines.append(f"\n  Schedule {sec} ({len(rows)} items):")
            for row in rows[:10]:
                code = row.get("item_code", "")
                desc = row.get("description", "")[:48]
                val = row.get("value", "")
                lines.append(f"    {code:<12} {desc:<50} {val}")
            if len(rows) > 10:
                lines.append(f"    ... and {len(rows) - 10} more rows")
        return "\n".join(lines)
    except requests.exceptions.Timeout:
        logger.warning("Timeout fetching schedule data for RSSD %s", rssd_id)
        return f"Request timed out fetching schedule data for RSSD {rssd_id}."
    except requests.exceptions.HTTPError as exc:
        status = exc.response.status_code
        if status == 404:
            return f"No filing found for RSSD {rssd_id} for period {reporting_period}."
        logger.error("HTTP %s fetching schedule data for RSSD %s", status, rssd_id)
        return f"Backend returned {status} for RSSD {rssd_id}."
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
        data = _get(
            "/reports/available-sections",
            {"rssd_id": rssd_id, "reporting_period": reporting_period},
        )
        sections = data.get("available_sections", [])
        return f"Available schedules — RSSD {rssd_id} ({reporting_period}): {', '.join(sections)}"
    except requests.exceptions.Timeout:
        logger.warning("Timeout fetching available schedules for RSSD %s", rssd_id)
        return f"Request timed out fetching schedules for RSSD {rssd_id}."
    except requests.exceptions.HTTPError as exc:
        status = exc.response.status_code
        if status == 404:
            return f"No filing found for RSSD {rssd_id} for period {reporting_period}."
        logger.error("HTTP %s fetching schedules for RSSD %s", status, rssd_id)
        return f"Backend returned {status} for RSSD {rssd_id}."
    except Exception as exc:
        logger.exception("Unexpected error in get_available_schedules")
        return f"Error fetching schedules: {exc}"