import logging
from typing import List
from fastapi import APIRouter, Query, HTTPException
from app.services.ubpr_service import UBPRService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ubpr", tags=["UBPR"])
service = UBPRService()


@router.get("/quarters")
def get_available_quarters():
    return {"quarters": service.get_available_quarters()}


@router.get("/ratios")
def get_key_ratios(
    rssd_id: str = Query(...),
    quarter_date: str = Query(...),
):
    try:
        return service.get_key_ratios(rssd_id, quarter_date)
    except Exception as e:
        logger.error(f"Failed to fetch ratios: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/trend")
def get_trend(
    rssd_id: str = Query(...),
    from_quarter: str = Query(...),
    to_quarter: str = Query(...),
    codes: List[str] = Query(...),
):
    try:
        start = min(from_quarter, to_quarter)
        end   = max(from_quarter, to_quarter)
        all_quarters = service.get_available_quarters()
        return service.get_trend_data(rssd_id, start, end, all_quarters, codes)
    except Exception as e:
        logger.error(f"Failed to fetch trend data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/peer-comparison")
def get_peer_comparison(
    rssd_id: str = Query(...),
    quarter_date: str = Query(...),
    peer_group: str = Query("all"),
):
    try:
        return service.get_peer_comparison(rssd_id, quarter_date, peer_group)
    except Exception as e:
        logger.error(f"Failed to fetch peer comparison: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/all-fields")
def get_all_fields(
    rssd_id: str = Query(...),
    quarter_date: str = Query(...),
):
    try:
        return service.get_all_fields(rssd_id, quarter_date)
    except Exception as e:
        logger.error(f"Failed to fetch all fields: {e}")
        raise HTTPException(status_code=500, detail=str(e))