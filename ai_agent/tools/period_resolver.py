"""
period_resolver.py

Smart date/quarter resolution for FFIEC reporting periods.
Converts natural language like "Q3", "last quarter", "March 2024"
into exact FFIEC period strings (MM/DD/YYYY) or UBPR quarter strings (YYYYMMDD).
"""

from datetime import date, datetime
from typing import Optional
import re

QUARTER_ENDS  = {1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31"}
QUARTER_NAMES = {
    "q1": 1, "q2": 2, "q3": 3, "q4": 4,
    "first": 1, "second": 2, "third": 3, "fourth": 4,
    "1st": 1, "2nd": 2, "3rd": 3, "4th": 4,
    "march": 1, "june": 2, "september": 3, "december": 4,
    "mar": 1, "jun": 2, "sep": 3, "dec": 4,
}
MONTH_TO_QUARTER = {
    1: 1, 2: 1, 3: 1,
    4: 2, 5: 2, 6: 2,
    7: 3, 8: 3, 9: 3,
    10: 4, 11: 4, 12: 4,
}

def current_quarter() -> tuple:
    today = date.today()
    return today.year, MONTH_TO_QUARTER[today.month]

def quarter_to_ffiec(year: int, quarter: int) -> str:
    end = QUARTER_ENDS[quarter]
    month, day = end.split("-")
    return f"{month}/{day}/{year}"

def quarter_to_ubpr(year: int, quarter: int) -> str:
    end = QUARTER_ENDS[quarter]
    month, day = end.split("-")
    return f"{year}{month}{day}"

def resolve_period(text: str, available_periods: list = None) -> dict:
    """
    Resolve natural language period reference to FFIEC and UBPR formats.

    Args:
        text: Natural language e.g. "Q3 2025", "last quarter", "March 2024"
        available_periods: List of available FFIEC periods for nearest-match fallback

    Returns:
        dict with ffiec, ubpr, year, quarter, resolved_from, exact_match, nearest_match
    """
    text = text.lower().strip()
    cur_year, cur_q = current_quarter()
    year = quarter = None

    year_match = re.search(r'\b(20\d{2})\b', text)
    if year_match:
        year = int(year_match.group(1))

    if "last quarter" in text or "previous quarter" in text:
        quarter = cur_q - 1 if cur_q > 1 else 4
        year    = cur_year if cur_q > 1 else cur_year - 1
    elif "this quarter" in text or "current quarter" in text:
        quarter, year = cur_q, cur_year
    elif "last year" in text:
        year, quarter = cur_year - 1, 4
    else:
        for name, q in QUARTER_NAMES.items():
            if name in text:
                quarter = q
                break

    if quarter and not year: year = cur_year
    if year and not quarter: quarter = 4
    if not year:    year    = cur_year
    if not quarter: quarter = cur_q

    ffiec = quarter_to_ffiec(year, quarter)
    ubpr  = quarter_to_ubpr(year, quarter)
    label = f"Q{quarter} {year}"

    result = {
        "ffiec": ffiec, "ubpr": ubpr,
        "year": year,   "quarter": quarter,
        "resolved_from": label,
        "exact_match": True, "nearest_match": None,
    }

    if available_periods and ffiec not in available_periods:
        result["exact_match"] = False
        target  = datetime.strptime(ffiec, "%m/%d/%Y")
        nearest = min(available_periods,
                      key=lambda p: abs((datetime.strptime(p, "%m/%d/%Y") - target).days))
        result["nearest_match"] = nearest
        result["ffiec"] = nearest
        dt = datetime.strptime(nearest, "%m/%d/%Y")
        result["ubpr"] = dt.strftime("%Y%m%d")

    return result
