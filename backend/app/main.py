from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

from app.routes import health, periods, banks, reports, ubpr

app = FastAPI(title="FFIEC Call Report API")

_extra = os.getenv("ALLOWED_ORIGIN", "")

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

if _extra:
    origins.append(_extra)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(periods.router)
app.include_router(banks.router)
app.include_router(reports.router)
app.include_router(ubpr.router)