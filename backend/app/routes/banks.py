from fastapi import APIRouter, Query
from app.services.bank_service import BankService

router = APIRouter(prefix="/banks", tags=["Banks"])

service = BankService()


@router.get("/")
async def get_banks(reporting_period: str = Query(...)):
    return await service.get_banks(reporting_period)