from app.clients.ffiec_client import FFIECClient
from app.utils.sdf_parser import decode_sdf_response_text, parse_sdf_text, group_sections


class ReportService:
    def __init__(self):
        self.client = FFIECClient()

    async def get_call_report_pdf(self, rssd_id: int, reporting_period: str):
        return await self.client.retrieve_call_report_pdf(rssd_id, reporting_period)

    async def get_sdf_report(self, rssd_id: int, reporting_period: str) -> dict:
        response = await self.client.get_facsimile(
            reporting_period=reporting_period,
            fi_id_type="ID_RSSD",
            fi_id=rssd_id,
            facsimile_format="SDF",
        )

        sdf_text = decode_sdf_response_text(response.text)
        rows = parse_sdf_text(sdf_text)
        sections = group_sections(rows)

        return {
            "rssd_id": rssd_id,
            "reporting_period": reporting_period,
            "source_format": "SDF",
            "raw_preview": sdf_text[:2000],
            "available_sections": sorted(sections.keys()),
            "sections": sections,
            "all_rows": rows,
        }

    async def get_selected_sections(self, rssd_id: int, reporting_period: str, selected_sections: list[str]) -> dict:
        data = await self.get_sdf_report(rssd_id, reporting_period)

        filtered_sections = {
            section: data["sections"].get(section, [])
            for section in selected_sections
        }

        return {
            "rssd_id": rssd_id,
            "reporting_period": reporting_period,
            "selected_sections": selected_sections,
            "sections": filtered_sections,
        }

    def build_metrics(self, rows: list[dict]) -> dict:
        """
        Compute key financial metrics from all parsed SDF rows.

        Design rules:
          - Never default to 0 when a value is missing: use None so the UI
            can distinguish "zero" from "not found".
          - For each metric, try every known FFIEC item-code variant in
            priority order and return the first non-null numeric value.
          - Build the lookup map once O(n) then do O(1) lookups per metric.
        """

        def parse_value(raw) -> float | None:
            if raw is None:
                return None
            text = str(raw).strip().replace(",", "").replace("%", "")
            if not text:
                return None
            try:
                return float(text)
            except ValueError:
                return None

        # Build {UPPER_CODE: row} map — keep first occurrence of each code.
        rows_by_code: dict[str, dict] = {}
        for row in rows:
            code = (row.get("item_code") or "").strip().upper()
            if code and code not in rows_by_code:
                rows_by_code[code] = row

        def get_val(*codes: str) -> float | None:
            """Return first parseable numeric value across the given code list."""
            for code in codes:
                row = rows_by_code.get(code.upper())
                if row is None:
                    continue
                parsed = parse_value(row.get("value"))
                if parsed is not None:
                    return parsed
            return None  # explicitly None — never fall back to 0

        # Total assets
        # RCFD2170 consolidated (most common), RCON2170 domestic, RCFD3368 alt
        total_assets = get_val("RCFD2170", "RCON2170", "RCOA2170", "RCFD3368")

        # Total loans & leases
        # RCFD2122 / RCON2122 standard, RCFD1400 net loans alt
        total_loans = get_val("RCFD2122", "RCON2122", "RCFD1400", "RCON1400")

        # Residential real-estate sub-components
        res_1_4       = get_val("RCON1797", "RCFD1797")
        multifamily   = get_val("RCON1460", "RCFD1460")
        construction  = get_val("RCON1410", "RCFD1410", "RCFD1415", "RCON1415")

        residential_total: float | None = None
        found = [v for v in (res_1_4, multifamily, construction) if v is not None]
        if found:
            residential_total = sum(found)

        residential_ratio: float | None = None
        if residential_total is not None and total_loans:
            residential_ratio = residential_total / total_loans

        # Capital / equity
        total_equity = get_val("RCFD3210", "RCON3210")

        # Net income (RI schedule)
        net_income = get_val("RIAD4340")

        # Total deposits
        total_deposits = get_val("RCFD2200", "RCON2200")

        return {
            "total_assets": total_assets,
            "total_loans": total_loans,
            "total_deposits": total_deposits,
            "total_equity": total_equity,
            "net_income": net_income,
            "residential_total": residential_total,
            "residential_ratio": residential_ratio,
            "equity_to_assets": (total_equity / total_assets)
                if (total_equity is not None and total_assets)
                else None,
            "loans_to_deposits": (total_loans / total_deposits)
                if (total_loans is not None and total_deposits)
                else None,
        }
