"""
chat_endpoint.py

FastAPI endpoint for dashboard integration.
Mounts at POST /agent/chat in the existing backend.
Streams responses via Server-Sent Events (SSE).

Response includes:
    - message: The AI's text response
    - action: Dashboard navigation instructions
    - sources: Data sources used
"""

import os
import sys
import json
from typing import Optional
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Ensure ai_agent directory is in path whether running standalone or mounted in backend
_ai_agent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ai_agent_dir not in sys.path:
    sys.path.insert(0, _ai_agent_dir)

# Load ai_agent .env if present (local dev)
from dotenv import load_dotenv
_env_path = os.path.join(_ai_agent_dir, ".env")
if os.path.exists(_env_path):
    load_dotenv(_env_path)

router = APIRouter(prefix="/agent", tags=["AI Agent"])


class ChatRequest(BaseModel):
    question: str
    rssd_id: Optional[str] = None
    bank_name: Optional[str] = None
    quarter: Optional[str] = None          # YYYYMMDD for UBPR
    period: Optional[str] = None           # MM/DD/YYYY for Call Report
    available_periods: Optional[list] = []
    thread_id: str = "default"
    stream: Optional[bool] = True


class ChatResponse(BaseModel):
    message: str
    action: Optional[dict] = None
    sources: Optional[list] = []


def _build_action(question: str, rssd_id: Optional[str], quarter: Optional[str], period: Optional[str]) -> dict:
    """
    Build dashboard action based on question content.
    Frontend reads this to navigate tabs and load data.
    """
    q = question.lower()

    # Detect which tab to navigate to
    if any(x in q for x in ["pdf", "report", "filing", "facsimile"]):
        tab = "pdf"
    elif any(x in q for x in ["balance sheet", "schedule rc", "assets", "deposits", "loans"]):
        tab = "sections"
    elif any(x in q for x in ["trend", "over time", "history", "quarterly"]):
        tab = "trends"
    elif any(x in q for x in ["peer", "compare", "benchmark", "industry"]):
        tab = "peers"
    elif any(x in q for x in ["ratio", "capital", "roa", "roe", "nim", "ubpr"]):
        tab = "summary"
    else:
        tab = "summary"

    # Detect action type
    if any(x in q for x in ["call report", "filing", "schedule", "balance sheet", "income"]):
        action_type = "load_report"
    else:
        action_type = "load_ubpr"

    return {
        "type": action_type,
        "rssd_id": rssd_id,
        "quarter": quarter,
        "period": period,
        "tab": tab,
    }


@router.post("/chat")
async def chat_endpoint(request: ChatRequest):
    """
    Main chat endpoint for the dashboard AI assistant.
    Accepts bank context from the frontend and streams the response.
    """
    from agents.orchestrator import chat

    if request.stream:
        async def generate():
            try:
                stream = chat(
                    question=request.question,
                    rssd_id=request.rssd_id,
                    bank_name=request.bank_name,
                    quarter=request.quarter,
                    period=request.period,
                    available_periods=request.available_periods or [],
                    thread_id=request.thread_id or "default",
                    stream=True,
                )

                full_message = ""
                from langchain_core.messages import AIMessage

                for chunk, metadata in stream:
                    if hasattr(chunk, "content") and isinstance(chunk, AIMessage) and chunk.content:
                        full_message += str(chunk.content) if not isinstance(chunk.content, list) else " ".join(b.get("text","") for b in chunk.content if isinstance(b,dict))
                        data = json.dumps({"type": "token", "content": chunk.content})
                        yield f"data: {data}\n\n"

                # Send final action after full message is assembled
                action = None
                if request.rssd_id:
                    action = _build_action(
                        request.question,
                        request.rssd_id,
                        request.quarter,
                        request.period,
                    )

                final = json.dumps({
                    "type": "done",
                    "message": full_message,
                    "action": action,
                    "sources": ["FFIEC UBPR", "FFIEC Call Reports"],
                })
                yield f"data: {final}\n\n"

            except Exception as e:
                error = json.dumps({"type": "error", "content": str(e)})
                yield f"data: {error}\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    else:
        # Non-streaming response
        response = str(chat(
            question=request.question,
            rssd_id=request.rssd_id,
            bank_name=request.bank_name,
            quarter=request.quarter,
            period=request.period,
            available_periods=request.available_periods or [],
            thread_id=request.thread_id or "default",
            stream=False,
        ))

        action = None
        if request.rssd_id:
            action = _build_action(
                request.question,
                request.rssd_id,
                request.quarter,
                request.period,
            )

        return ChatResponse(
            message=response,
            action=action,
            sources=["FFIEC UBPR", "FFIEC Call Reports"],
        )