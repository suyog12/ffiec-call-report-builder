import os
import sys
import json
import logging
from typing import Optional
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from langchain_core.messages import AIMessage

logger = logging.getLogger(__name__)

_ai_agent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ai_agent_dir not in sys.path:
    sys.path.insert(0, _ai_agent_dir)

from dotenv import load_dotenv
_env_path = os.path.join(_ai_agent_dir, ".env")
if os.path.exists(_env_path):
    load_dotenv(_env_path)

router = APIRouter(prefix="/agent", tags=["AI Agent"])

_UBPR_TAB_KEYWORDS = frozenset(["ratio", "capital", "roa", "roe", "nim", "ubpr", "peer", "regulatory"])
_TREND_KEYWORDS = frozenset(["trend", "over time", "history", "quarterly"])
_PEER_KEYWORDS = frozenset(["peer", "compare", "benchmark", "industry"])
_PDF_KEYWORDS = frozenset(["pdf", "report", "filing", "facsimile"])
_SECTIONS_KEYWORDS = frozenset(["balance sheet", "schedule rc", "assets", "deposits", "loans"])

_CALL_REPORT_ACTION_KEYWORDS = frozenset([
    "call report", "filing", "schedule", "balance sheet", "income",
])


class ChatRequest(BaseModel):
    question: str
    rssd_id: Optional[str] = None
    bank_name: Optional[str] = None
    quarter: Optional[str] = None
    period: Optional[str] = None
    available_periods: Optional[list] = []
    thread_id: str = "default"
    stream: Optional[bool] = True


class ChatResponse(BaseModel):
    message: str
    action: Optional[dict] = None
    sources: Optional[list] = []


def _infer_tab(question: str) -> str:
    q = question.lower()
    if any(kw in q for kw in _PDF_KEYWORDS):
        return "pdf"
    if any(kw in q for kw in _SECTIONS_KEYWORDS):
        return "sections"
    if any(kw in q for kw in _TREND_KEYWORDS):
        return "trends"
    if any(kw in q for kw in _PEER_KEYWORDS):
        return "peers"
    return "summary"


def _build_action(
    question: str,
    rssd_id: Optional[str],
    quarter: Optional[str],
    period: Optional[str],
) -> dict:
    q = question.lower()
    action_type = (
        "load_report"
        if any(kw in q for kw in _CALL_REPORT_ACTION_KEYWORDS)
        else "load_ubpr"
    )
    return {
        "type": action_type,
        "rssd_id": rssd_id,
        "quarter": quarter,
        "period": period,
        "tab": _infer_tab(question),
    }


@router.post("/chat")
async def chat_endpoint(request: ChatRequest):
    from agents.orchestrator import chat

    if not request.stream:
        try:
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
        except Exception as exc:
            logger.exception("Non-streaming chat failed for thread %s", request.thread_id)
            response = f"The AI assistant encountered an unexpected error: {str(exc)[:200]}"

        action = None
        if request.rssd_id:
            action = _build_action(request.question, request.rssd_id, request.quarter, request.period)

        return ChatResponse(
            message=response,
            action=action,
            sources=["FFIEC UBPR", "FFIEC Call Reports"],
        )

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

            for chunk, metadata in stream:
                if not (hasattr(chunk, "content") and isinstance(chunk, AIMessage) and chunk.content):
                    continue
                text = (
                    chunk.content
                    if not isinstance(chunk.content, list)
                    else " ".join(b.get("text", "") for b in chunk.content if isinstance(b, dict))
                )
                full_message += str(text)
                yield f"data: {json.dumps({'type': 'token', 'content': chunk.content})}\n\n"

            action = None
            if request.rssd_id:
                action = _build_action(
                    request.question, request.rssd_id, request.quarter, request.period
                )

            yield f"data: {json.dumps({'type': 'done', 'message': full_message, 'action': action, 'sources': ['FFIEC UBPR', 'FFIEC Call Reports']})}\n\n"

        except Exception as exc:
            logger.exception("Streaming chat failed for thread %s", request.thread_id)
            yield f"data: {json.dumps({'type': 'error', 'content': str(exc)[:200]})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )