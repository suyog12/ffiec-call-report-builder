from typing import List
from fastapi import APIRouter, Query
from fastapi.responses import Response
from app.services.report_service import ReportService

router = APIRouter(prefix="/reports", tags=["Reports"])

service = ReportService()


@router.get("/pdf")
async def get_report_pdf(
    rssd_id: int = Query(...),
    reporting_period: str = Query(...),
):
    pdf_bytes = await service.get_call_report_pdf(rssd_id, reporting_period)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'inline; filename="call_report_{rssd_id}'
                f'_{reporting_period.replace("/", "-")}.pdf"'
            )
        },
    )


@router.get("/sdf")
async def get_report_sdf(
    rssd_id: int = Query(...),
    reporting_period: str = Query(...),
):
    return await service.get_sdf_report(rssd_id, reporting_period)


@router.get("/available-sections")
async def get_available_sections(
    rssd_id: int = Query(...),
    reporting_period: str = Query(...),
):
    data = await service.get_sdf_report(rssd_id, reporting_period)
    return {
        "rssd_id": rssd_id,
        "reporting_period": reporting_period,
        "available_sections": data["available_sections"],
    }


@router.get("/section-data")
async def get_section_data(
    rssd_id: int = Query(...),
    reporting_period: str = Query(...),
    sections: List[str] = Query(...),
):
    return await service.get_selected_sections(rssd_id, reporting_period, sections)


@router.get("/metrics")
async def get_metrics(
    rssd_id: int = Query(...),
    reporting_period: str = Query(...),
):
    data = await service.get_sdf_report(rssd_id, reporting_period)
    metrics = service.build_metrics(data["all_rows"])

    # Include which item_codes were found so the frontend can debug easily
    codes_found = {
        (row.get("item_code") or "").strip().upper(): True
        for row in data["all_rows"]
    }

    return {
        "rssd_id": rssd_id,
        "reporting_period": reporting_period,
        "total_rows_parsed": len(data["all_rows"]),
        "metrics": metrics,
    }


@router.get("/all-fields")
async def get_all_fields(
    rssd_id: int = Query(...),
    reporting_period: str = Query(...),
):
    """
    Returns every parsed SDF row, grouped by section.

    Shape returned:
    {
      rssd_id, reporting_period,
      available_sections: [...],
      sections: {
        "RC": [
          { item_code, description, value, line_number, section, ... },
          ...
        ],
        "RI": [...],
        ...
      },
      total_fields: <int>
    }

    The frontend Custom Report builder should use this endpoint -it
    gives the full field catalog needed for field-level selection.
    """
    data = await service.get_sdf_report(rssd_id, reporting_period)

    # Strip heavy/internal-only keys from each row before sending to frontend
    clean_sections: dict[str, list[dict]] = {}
    for section, rows in data["sections"].items():
        clean_sections[section] = [
            {
                "id": f"{row['section']}::{row['item_code']}",
                "item_code": row["item_code"],
                "description": row["description"],
                "value": row["value"],
                "line_number": row["line_number"],
                "section": row["section"],
                "last_update": row.get("last_update", ""),
            }
            for row in rows
        ]

    return {
        "rssd_id": rssd_id,
        "reporting_period": reporting_period,
        "available_sections": data["available_sections"],
        "sections": clean_sections,
        "total_fields": len(data["all_rows"]),
    }
