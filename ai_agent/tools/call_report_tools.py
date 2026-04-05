"""
call_report_tools.py

Custom LangChain tools for FFIEC Call Report data.
Each tool calls the deployed FFIEC backend API.

Tools:
    - get_available_periods   : List all available reporting periods
    - get_bank_metrics        : Fetch key financial metrics for a bank/period
    - get_schedule_data       : Fetch specific schedule data (RC, RI, etc.)
    - get_call_report_summary : Get a full summary of a bank's filing
"""

import os
import requests
from langchain_core.tools import tool

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")


@tool
def get_available_periods() -> str:
    """
    Fetch all available FFIEC Call Report reporting periods.

    Returns:
        List of available quarter-end dates in MM/DD/YYYY format,
        most recent first.
    """
    try:
        resp = requests.get(f"{BACKEND_URL}/periods/", timeout=15)
        resp.raise_for_status()
        periods = resp.json()
        if isinstance(periods, list):
            return f"Available periods ({len(periods)} total): " + ", ".join(periods[:12]) + " ..."
        return str(periods)
    except Exception as e:
        return f"Error fetching periods: {str(e)}"


@tool
def get_bank_metrics(rssd_id: str, reporting_period: str) -> str:
    """
    Fetch key financial metrics for a bank from their Call Report filing.

    Args:
        rssd_id: The bank's RSSD ID (e.g. "480228")
        reporting_period: Period in MM/DD/YYYY format (e.g. "12/31/2025")

    Returns:
        Key metrics including total assets, loans, deposits, equity, net income,
        and computed ratios like equity-to-assets and loans-to-deposits.
    """
    try:
        resp = requests.get(
            f"{BACKEND_URL}/reports/metrics",
            params={"rssd_id": rssd_id, "reporting_period": reporting_period},
            timeout=30,
        )
        resp.raise_for_status()
        data    = resp.json()
        metrics = data.get("metrics", {})
        if not metrics:
            return f"No metrics found for RSSD {rssd_id} for period {reporting_period}."

        def fmt(v):
            if v is None: return "N/A"
            try:
                n = float(v)
                if abs(n) >= 1e12: return f"${n/1e12:.2f}T"
                if abs(n) >= 1e9:  return f"${n/1e9:.2f}B"
                if abs(n) >= 1e6:  return f"${n/1e6:.2f}M"
                return f"${n:,.0f}"
            except Exception:
                return str(v)

        lines = [f"Call Report Metrics for RSSD {rssd_id} ({reporting_period}):"]
        for key, val in metrics.items():
            label = key.replace("_", " ").title()
            lines.append(f"  {label}: {fmt(val)}")
        return "\n".join(lines)
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            return f"No Call Report filing found for RSSD {rssd_id} for period {reporting_period}. The report may not have been filed yet."
        return f"Error fetching metrics: {str(e)}"
    except Exception as e:
        return f"Error fetching metrics: {str(e)}"


@tool
def get_schedule_data(rssd_id: str, reporting_period: str, schedules: str = "RC,RI") -> str:
    """
    Fetch specific Call Report schedule data for a bank.

    Args:
        rssd_id: The bank's RSSD ID
        reporting_period: Period in MM/DD/YYYY format
        schedules: Comma-separated schedule codes e.g. "RC,RI,RC-C"
                   RC = Balance Sheet, RI = Income Statement, RC-C = Loans

    Returns:
        Row-level data from the requested schedules including item codes,
        descriptions, and values.
    """
    try:
        schedule_list = [s.strip() for s in schedules.split(",")]
        resp = requests.get(
            f"{BACKEND_URL}/reports/section-data",
            params={
                "rssd_id": rssd_id,
                "reporting_period": reporting_period,
                "sections": schedule_list,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data     = resp.json()
        sections = data.get("sections", {})
        if not sections:
            return f"No schedule data found for {schedules}."

        lines = [f"Schedule Data for RSSD {rssd_id} ({reporting_period}):"]
        for sec, rows in sections.items():
            lines.append(f"\n  Schedule {sec} ({len(rows)} items):")
            for row in rows[:10]:
                code = row.get("item_code", "")
                desc = row.get("description", "")[:50]
                val  = row.get("value", "")
                lines.append(f"    {code:<12} {desc:<52} {val}")
            if len(rows) > 10:
                lines.append(f"    ... and {len(rows)-10} more rows")
        return "\n".join(lines)
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            return f"No filing found for RSSD {rssd_id} for period {reporting_period}."
        return f"Error fetching schedule data: {str(e)}"
    except Exception as e:
        return f"Error fetching schedule data: {str(e)}"


@tool
def get_available_schedules(rssd_id: str, reporting_period: str) -> str:
    """
    List all schedules available in a bank's Call Report filing.

    Args:
        rssd_id: The bank's RSSD ID
        reporting_period: Period in MM/DD/YYYY format

    Returns:
        List of schedule codes present in this bank's filing.
    """
    try:
        resp = requests.get(
            f"{BACKEND_URL}/reports/available-sections",
            params={"rssd_id": rssd_id, "reporting_period": reporting_period},
            timeout=20,
        )
        resp.raise_for_status()
        data     = resp.json()
        sections = data.get("available_sections", [])
        return f"Available schedules for RSSD {rssd_id} ({reporting_period}): {', '.join(sections)}"
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            return f"No filing found for RSSD {rssd_id} for period {reporting_period}."
        return f"Error: {str(e)}"
    except Exception as e:
        return f"Error: {str(e)}"
