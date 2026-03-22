from fastapi import APIRouter
from app.services.period_service import PeriodService

router = APIRouter(prefix="/periods", tags=["Periods"])

service = PeriodService()


@router.get("/")
async def get_periods():
    return await service.get_periods()