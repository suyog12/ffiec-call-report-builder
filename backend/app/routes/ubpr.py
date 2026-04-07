import logging
import os
from typing import List
from fastapi import APIRouter, Query, HTTPException, Header
from app.services.ubpr_service import UBPRService

logger  = logging.getLogger(__name__)
router  = APIRouter(prefix="/ubpr", tags=["UBPR"])
service = UBPRService()
_INTERNAL_TOKEN = os.getenv("INTERNAL_API_TOKEN", "")


@router.get("/quarters")
def get_available_quarters():
    try:
        return {"quarters": service.get_available_quarters()}
    except Exception as e:
        logger.error(f"Failed to list quarters: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/availability")
def check_availability(rssd_id: str = Query(...), quarter_date: str = Query(...)):
    """Check if a bank has data for a quarter before loading charts."""
    try:
        available = service.bank_has_data(rssd_id, quarter_date)
        return {"available": available, "rssd_id": rssd_id, "quarter_date": quarter_date}
    except Exception as e:
        logger.error(f"Availability check failed: {e}")
        return {"available": False, "rssd_id": rssd_id, "quarter_date": quarter_date}


@router.get("/ratios")
def get_key_ratios(rssd_id: str = Query(...), quarter_date: str = Query(...)):
    try:
        if not service.bank_has_data(rssd_id, quarter_date):
            raise HTTPException(status_code=404,
                detail=f"No UBPR data for RSSD {rssd_id} in {quarter_date}.")
        return service.get_key_ratios(rssd_id, quarter_date)
    except HTTPException:
        raise
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
        logger.error(f"Failed to fetch trend: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/peer-comparison")
def get_peer_comparison(
    rssd_id: str = Query(...),
    quarter_date: str = Query(...),
    peer_group: str = Query("all"),
):
    try:
        if not service.bank_has_data(rssd_id, quarter_date):
            raise HTTPException(status_code=404,
                detail=f"No data for RSSD {rssd_id} in {quarter_date}.")
        return service.get_peer_comparison(rssd_id, quarter_date, peer_group)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch peer comparison: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/all-fields")
def get_all_fields(rssd_id: str = Query(...), quarter_date: str = Query(...)):
    try:
        if not service.bank_has_data(rssd_id, quarter_date):
            raise HTTPException(status_code=404,
                detail=f"No data for RSSD {rssd_id} in {quarter_date}.")
        return service.get_all_fields(rssd_id, quarter_date)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch all fields: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cache/clear")
def clear_cache(x_internal_token: str = Header(default="", alias="X-Internal-Token")):
    """Called by GitHub Actions after ingestion to flush DuckDB cache."""
    if _INTERNAL_TOKEN and x_internal_token != _INTERNAL_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid internal token.")
    try:
        service.clear_cache()
        return {"status": "ok", "message": "Cache cleared."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))