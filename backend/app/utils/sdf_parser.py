import base64
import csv
import io
import json
from typing import Any


def decode_sdf_response_text(response_text: str) -> str:
    text = response_text.strip()

    try:
        parsed = json.loads(text)
        if isinstance(parsed, str):
            text = parsed.strip()
    except Exception:
        pass

    try:
        decoded = base64.b64decode(text, validate=True)
        try:
            return decoded.decode("utf-8")
        except UnicodeDecodeError:
            return decoded.decode("latin-1")
    except Exception:
        pass

    return text


def normalize_schedule(schedule: str | None) -> str | None:
    if not schedule:
        return None

    s = schedule.strip().upper()

    # Exact matches
    if s == "RI":
        return "RI"

    # RC and its variants
    if s.startswith("RC") and not s.startswith("RCC"):
        return "RC"

    # RC-C variants
    if s.startswith("RCC"):
        return "RC-C"

    return s


def parse_sdf_text(sdf_text: str) -> list[dict[str, Any]]:
    rows = []
    reader = csv.reader(io.StringIO(sdf_text), delimiter=";")

    all_lines = list(reader)
    if not all_lines:
        return rows

    # skip header row
    data_lines = all_lines[1:]

    for idx, cols in enumerate(data_lines, start=2):
        cleaned = [c.strip() for c in cols]

        # pad in case some rows are short
        while len(cleaned) < 8:
            cleaned.append("")

        call_date = cleaned[0]
        bank_rssd = cleaned[1]
        mdrm = cleaned[2]
        value = cleaned[3]
        last_update = cleaned[4]
        short_definition = cleaned[5]
        call_schedule = cleaned[6]
        line_number = cleaned[7]

        row = {
            "source_line_number": idx,
            "call_date": call_date,
            "bank_rssd": bank_rssd,
            "item_code": mdrm,
            "value": value,
            "last_update": last_update,
            "description": short_definition,
            "section": normalize_schedule(call_schedule),
            "line_number": line_number,
            "raw": ";".join(cleaned),
            "columns": cleaned,
        }

        rows.append(row)

    return rows


def group_sections(rows):
    grouped = {}

    for row in rows:
        section = row.get("section")
        if not section:
            continue

        if section not in grouped:
            grouped[section] = []

        grouped[section].append(row)

    return grouped