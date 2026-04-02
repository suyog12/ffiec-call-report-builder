from typing import List
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import Response
from app.services.report_service import ReportService
import logging

router = APIRouter(prefix="/reports", tags=["Reports"])
logger = logging.getLogger(__name__)
service = ReportService()


@router.get("/pdf")
async def get_report_pdf(
    rssd_id: int = Query(...),
    reporting_period: str = Query(...),
):
    try:
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
    except Exception as e:
        logger.error(f"PDF fetch failed [{rssd_id} {reporting_period}]: {e}")
        raise HTTPException(status_code=404, detail=f"Report not available for {reporting_period}. Data may not yet be filed with FFIEC.")


@router.get("/sdf")
async def get_report_sdf(
    rssd_id: int = Query(...),
    reporting_period: str = Query(...),
):
    try:
        return await service.get_sdf_report(rssd_id, reporting_period)
    except Exception as e:
        logger.error(f"SDF fetch failed [{rssd_id} {reporting_period}]: {e}")
        raise HTTPException(status_code=404, detail=f"Report not available for {reporting_period}.")


@router.get("/available-sections")
async def get_available_sections(
    rssd_id: int = Query(...),
    reporting_period: str = Query(...),
):
    try:
        data = await service.get_sdf_report(rssd_id, reporting_period)
        return {
            "rssd_id": rssd_id,
            "reporting_period": reporting_period,
            "available_sections": data["available_sections"],
        }
    except Exception as e:
        logger.error(f"Sections fetch failed [{rssd_id} {reporting_period}]: {e}")
        raise HTTPException(status_code=404, detail=f"Report not available for {reporting_period}.")


@router.get("/section-data")
async def get_section_data(
    rssd_id: int = Query(...),
    reporting_period: str = Query(...),
    sections: List[str] = Query(...),
):
    try:
        return await service.get_selected_sections(rssd_id, reporting_period, sections)
    except Exception as e:
        logger.error(f"Section data fetch failed [{rssd_id} {reporting_period}]: {e}")
        raise HTTPException(status_code=404, detail=f"Report not available for {reporting_period}.")


@router.get("/metrics")
async def get_metrics(
    rssd_id: int = Query(...),
    reporting_period: str = Query(...),
):
    try:
        data = await service.get_sdf_report(rssd_id, reporting_period)
        metrics = service.build_metrics(data["all_rows"])
        return {
            "rssd_id": rssd_id,
            "reporting_period": reporting_period,
            "total_rows_parsed": len(data["all_rows"]),
            "metrics": metrics,
        }
    except Exception as e:
        logger.error(f"Metrics fetch failed [{rssd_id} {reporting_period}]: {e}")
        raise HTTPException(status_code=404, detail=f"Report not available for {reporting_period}.")


@router.get("/all-fields")
async def get_all_fields(
    rssd_id: int = Query(...),
    reporting_period: str = Query(...),
):
    """
    Returns every parsed SDF row, grouped by section.
    Used by the Custom Report builder for field-level selection.
    Returns 404 with a clear message if the period has no data yet.
    """
    try:
        data = await service.get_sdf_report(rssd_id, reporting_period)
    except Exception as e:
        logger.error(f"all-fields fetch failed [{rssd_id} {reporting_period}]: {e}")
        raise HTTPException(
            status_code=404,
            detail=f"No filing data available for period {reporting_period}. "
                   f"This period may not yet have been filed with the FFIEC."
        )

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