from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

from app.routes import health, periods, banks, reports, ubpr

app = FastAPI(title="FFIEC Call Report API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(periods.router)
app.include_router(banks.router)
app.include_router(reports.router)
app.include_router(ubpr.router)