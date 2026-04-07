"""
ubpr.py
=======

All endpoints:
- Validate inputs before querying
- Return 404 (not 500) when data simply doesn't exist for a bank/quarter
- Return 422 for invalid input formats
- Never expose internal error details to the client
- Log full errors server-side for debugging
"""

from __future__ import annotations

import logging
import os
from typing import List

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import JSONResponse

from app.services.ubpr_service import UBPRService

logger  = logging.getLogger(__name__)
router  = APIRouter(prefix="/ubpr", tags=["UBPR Financial Analysis"])

# Singleton service — shared across requests (thread-safe due to internal locking)
_service = UBPRService()

# Internal token for cache-clear endpoint (called by GitHub Actions after ingestion)
_INTERNAL_TOKEN = os.getenv("INTERNAL_API_TOKEN", "")


def get_service() -> UBPRService:
    return _service


# Input validators

def _require_rssd(rssd_id: str) -> str:
    """Validate RSSD ID — must be 1-10 digits."""
    v = str(rssd_id).strip()
    if not v.isdigit() or len(v) > 10:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid rssd_id: {rssd_id!r}. Must be a numeric string (1-10 digits)."
        )
    return v


def _require_quarter(quarter_date: str) -> str:
    """Validate quarter_date — must be YYYYMMDD."""
    v = str(quarter_date).strip()
    if not v.isdigit() or len(v) != 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid quarter_date: {quarter_date!r}. Must be YYYYMMDD (e.g. 20251231)."
        )
    return v


# Endpoints

@router.get(
    "/quarters",
    summary="List available quarters",
    description="Returns all UBPR quarters stored in R2. "
                "Only show quarters returned here — others have no data.",
)
def get_available_quarters(
    service: UBPRService = Depends(get_service),
):
    try:
        quarters = service.get_available_quarters()
        return {"quarters": quarters, "count": len(quarters)}
    except Exception as e:
        logger.error(f"GET /ubpr/quarters failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve available quarters. Please try again."
        )


@router.get(
    "/availability",
    summary="Check data availability for a bank/quarter",
    description="Returns whether a specific bank has UBPR data for a given quarter. "
                "Call this before loading charts to avoid empty states.",
)
def check_availability(
    rssd_id:      str = Query(..., description="Bank RSSD ID (numeric)"),
    quarter_date: str = Query(..., description="Quarter in YYYYMMDD format"),
    service: UBPRService = Depends(get_service),
):
    rssd_id      = _require_rssd(rssd_id)
    quarter_date = _require_quarter(quarter_date)

    try:
        available = service.bank_has_data(rssd_id, quarter_date)
        return {
            "available":    available,
            "rssd_id":      rssd_id,
            "quarter_date": quarter_date,
        }
    except Exception as e:
        logger.error(f"GET /ubpr/availability failed [{rssd_id} {quarter_date}]: {e}")
        # Return False rather than 500 — availability check should never crash the client
        return {"available": False, "rssd_id": rssd_id, "quarter_date": quarter_date}


@router.get(
    "/ratios",
    summary="Fetch key UBPR ratios for one bank",
    description="Returns all non-null UBPR ratios plus a priority-ordered top-10 list "
                "for Executive Summary display. Returns 404 if no data exists.",
)
def get_key_ratios(
    rssd_id:      str = Query(..., description="Bank RSSD ID"),
    quarter_date: str = Query(..., description="Quarter YYYYMMDD"),
    service: UBPRService = Depends(get_service),
):
    rssd_id      = _require_rssd(rssd_id)
    quarter_date = _require_quarter(quarter_date)

    # Availability guard — fast HEAD request before any DuckDB scan
    if not service.bank_has_data(rssd_id, quarter_date):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No UBPR data found for RSSD {rssd_id} in quarter {quarter_date}. "
                   f"The institution may not have filed for this period."
        )

    try:
        result = service.get_key_ratios(rssd_id, quarter_date)
        if not result.get("ratios"):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No ratio data found for RSSD {rssd_id} in {quarter_date}."
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"GET /ubpr/ratios failed [{rssd_id} {quarter_date}]: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve ratio data. Please try again."
        )


@router.get(
    "/trend",
    summary="Fetch ratio trend across quarters",
    description="Returns requested ratio codes across a date range. "
                "Quarters where the bank has no data are silently skipped. "
                "from_quarter and to_quarter order is normalized automatically.",
)
def get_trend(
    rssd_id:      str       = Query(..., description="Bank RSSD ID"),
    from_quarter: str       = Query(..., description="Start quarter YYYYMMDD"),
    to_quarter:   str       = Query(..., description="End quarter YYYYMMDD"),
    codes:        List[str] = Query(..., description="UBPR column codes to fetch"),
    service: UBPRService = Depends(get_service),
):
    rssd_id      = _require_rssd(rssd_id)
    from_quarter = _require_quarter(from_quarter)
    to_quarter   = _require_quarter(to_quarter)

    if not codes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one ratio code must be specified."
        )

    try:
        all_quarters = service.get_available_quarters()
        result       = service.get_trend_data(
            rssd_id, from_quarter, to_quarter, all_quarters, codes
        )
        return result
    except Exception as e:
        logger.error(
            f"GET /ubpr/trend failed [{rssd_id} {from_quarter}→{to_quarter}]: {e}"
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve trend data. Please try again."
        )


@router.get(
    "/peer-comparison",
    summary="Compare bank ratios to peer group",
    description="Returns bank ratios, peer averages, and deltas (bank - peer) "
                "for key performance indicators.",
)
def get_peer_comparison(
    rssd_id:      str = Query(..., description="Bank RSSD ID"),
    quarter_date: str = Query(..., description="Quarter YYYYMMDD"),
    peer_group:   str = Query("all", description="Peer group identifier"),
    service: UBPRService = Depends(get_service),
):
    rssd_id      = _require_rssd(rssd_id)
    quarter_date = _require_quarter(quarter_date)

    if not service.bank_has_data(rssd_id, quarter_date):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No UBPR data for RSSD {rssd_id} in {quarter_date}."
        )

    try:
        return service.get_peer_comparison(rssd_id, quarter_date, peer_group)
    except Exception as e:
        logger.error(f"GET /ubpr/peer-comparison failed [{rssd_id} {quarter_date}]: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve peer comparison data. Please try again."
        )


@router.get(
    "/all-fields",
    summary="Fetch all UBPR fields for custom ratio builder",
    description="Returns every available UBPR column for one bank × one quarter. "
                "Used by the Build Ratio tab.",
)
def get_all_fields(
    rssd_id:      str = Query(..., description="Bank RSSD ID"),
    quarter_date: str = Query(..., description="Quarter YYYYMMDD"),
    service: UBPRService = Depends(get_service),
):
    rssd_id      = _require_rssd(rssd_id)
    quarter_date = _require_quarter(quarter_date)

    if not service.bank_has_data(rssd_id, quarter_date):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No UBPR data for RSSD {rssd_id} in {quarter_date}."
        )

    try:
        return service.get_all_fields(rssd_id, quarter_date)
    except Exception as e:
        logger.error(f"GET /ubpr/all-fields failed [{rssd_id} {quarter_date}]: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to retrieve field data. Please try again."
        )


@router.post(
    "/cache/clear",
    summary="Clear query cache",
    description="Flushes the in-process DuckDB result cache. "
                "Called automatically by GitHub Actions after ingestion. "
                "Requires X-Internal-Token header.",
)
def clear_cache(
    x_internal_token: str = Header(default="", alias="X-Internal-Token"),
    service: UBPRService = Depends(get_service),
):
    if _INTERNAL_TOKEN and x_internal_token != _INTERNAL_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing internal token."
        )
    try:
        service.clear_cache()
        logger.info("Query cache cleared via /ubpr/cache/clear")
        return {"status": "ok", "message": "Cache cleared successfully."}
    except Exception as e:
        logger.error(f"Cache clear failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cache clear failed. Please try again."
        )