from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import health, periods, banks, reports

app = FastAPI(title="FFIEC Call Report API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(periods.router)
app.include_router(banks.router)
app.include_router(reports.router)