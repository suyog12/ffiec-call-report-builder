from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
import sys

from app.routes import health, periods, banks, reports, ubpr

# Mount ai_agent server if available
agent_router = None
AGENT_AVAILABLE = False
try:
    _ai_agent_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "ai_agent")
    _ai_agent_path = os.path.normpath(_ai_agent_path)
    if _ai_agent_path not in sys.path:
        sys.path.insert(0, _ai_agent_path)
    from server.chat_endpoint import router as agent_router  # type: ignore[assignment]
    AGENT_AVAILABLE = True
except Exception as e:
    print(f"AI agent not available: {e}")

app = FastAPI(title="FFIEC Call Report API")

# All allowed origins — dev and production hardcoded so both always work
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "https://ffiec-call-report-builder.vercel.app",
    "https://ffiec-call-report-builder-4c8xo2lsu-suyog12s-projects.vercel.app",
]
# Optional extra origins from env (comma-separated)
_extra = os.getenv("ALLOWED_ORIGIN", "")
if _extra:
    origins.extend([o.strip() for o in _extra.split(",") if o.strip()])

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

if AGENT_AVAILABLE and agent_router is not None:
    app.include_router(agent_router)
    print("AI agent endpoint mounted at /agent/chat")