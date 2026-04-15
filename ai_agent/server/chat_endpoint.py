import os
import sys
import json
import re
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
    load_dotenv(_env_path, override=False)

router = APIRouter(prefix="/agent", tags=["AI Agent"])

# ── Metric name → UBPR code lookup ───────────────────────────────────────────
_METRIC_MAP = {
    "npl": "UBPR7414",
    "non-performing loans": "UBPR7414",
    "nonperforming loans": "UBPR7414",
    "non performing loans": "UBPR7414",
    "npl %": "UBPR7414",
    "noncurrent loans": "UBPR7414",
    "roa": "UBPRE013",
    "return on assets": "UBPRE013",
    "roe": "UBPRE630",
    "return on equity": "UBPRE630",
    "nim": "UBPRE018",
    "net interest margin": "UBPRE018",
    "cet1": "UBPRR031",
    "cet1 ratio": "UBPRR031",
    "tier 1": "UBPRD487",
    "tier1": "UBPRD487",
    "tier 1 capital": "UBPRD487",
    "tier 1 capital ratio": "UBPRD487",
    "total capital ratio": "UBPRD488",
    "leverage ratio": "UBPRD486",
    "equity to assets": "UBPR7308",
    "charge-off": "UBPRE019",
    "net charge-off": "UBPRE019",
    "charge off": "UBPRE019",
    "loan to deposit": "UBPRE600",
    "loan-to-deposit": "UBPRE600",
    "loans to deposits": "UBPRE600",
}

# ── Keyword sets for action routing ──────────────────────────────────────────
_TREND_KW    = frozenset(["trend", "over time", "history", "historical", "quarterly", "quarters", "from q", "since q"])
_PEER_KW     = frozenset(["peer", "compare", "benchmark", "industry average", "peer group"])
_PDF_KW      = frozenset(["pdf", "filing", "facsimile"])
_SECTIONS_KW = frozenset(["schedule rc", "schedule ri", "schedule rc-c", "balance sheet sections", "line items", "schedule data"])
_METRICS_KW  = frozenset(["total assets", "total loans", "total deposits", "net income", "equity", "metrics", "key financials"])
_CALL_KW     = frozenset([
    "balance sheet", "income statement", "schedule", "call report",
    "filing", "deposits", "loans", "assets", "net income", "metrics",
])


def _detect_metric_code(question: str) -> Optional[str]:
    """Extract a UBPR code from question text."""
    # Check for explicit code first
    match = re.search(r"\bUBPR[A-Z0-9]{4,}\b", question.upper())
    if match:
        return match.group(0)
    # Check name mappings, longest match first
    q = question.lower()
    for name in sorted(_METRIC_MAP, key=len, reverse=True):
        if name in q:
            return _METRIC_MAP[name]
    return None


def _detect_quarters(question: str, available_quarters: list) -> tuple:
    """Extract from/to quarter range from question. Returns (from_q, to_q) or (None, None)."""
    if not available_quarters:
        return None, None
    q = question.lower()
    year_q_pat = r"q([1-4])\s*(\d{4})"
    matches = re.findall(year_q_pat, q)
    if len(matches) >= 2:
        ends = {"1": "0331", "2": "0630", "3": "0930", "4": "1231"}
        from_q = f"{matches[0][1]}{ends[matches[0][0]]}"
        to_q   = f"{matches[1][1]}{ends[matches[1][0]]}"
        return (min(from_q, to_q), max(from_q, to_q))
    # Default: latest 8 quarters
    to_q   = available_quarters[0] if available_quarters else None
    from_q = available_quarters[min(7, len(available_quarters) - 1)] if available_quarters else None
    return from_q, to_q


def _build_action(
    question: str,
    rssd_id: Optional[str],
    quarter: Optional[str],
    period: Optional[str],
    available_quarters: list,
) -> dict:
    q = question.lower()

    # Determine section (ubpr vs call report)
    is_call = any(kw in q for kw in _CALL_KW)

    # Determine tab within section
    if any(kw in q for kw in _TREND_KW):
        tab = "trends"
    elif any(kw in q for kw in _PEER_KW):
        tab = "peers"
    elif any(kw in q for kw in _PDF_KW):
        tab = "pdf"
    elif any(kw in q for kw in _SECTIONS_KW):
        tab = "sections"
    elif any(kw in q for kw in _METRICS_KW):
        tab = "metrics" if is_call else "summary"
    else:
        tab = "metrics" if is_call else "summary"

    action_type = "load_report" if is_call else "load_ubpr"

    action: dict = {
        "type": action_type,
        "rssd_id": rssd_id,
        "quarter": quarter,
        "period": period,
        "tab": tab,
    }

    # Enrich trend actions with metric code + quarter range
    if tab == "trends" and rssd_id:
        metric_code = _detect_metric_code(question)
        from_q, to_q = _detect_quarters(question, available_quarters)
        if metric_code:
            action["metric_code"] = metric_code
        if from_q:
            action["from_quarter"] = from_q
        if to_q:
            action["to_quarter"] = to_q

    return action


class ChatRequest(BaseModel):
    question: str
    rssd_id: Optional[str] = None
    bank_name: Optional[str] = None
    quarter: Optional[str] = None
    period: Optional[str] = None
    available_periods: Optional[list] = []
    available_quarters: Optional[list] = []
    thread_id: str = "default"
    stream: Optional[bool] = True


class ChatResponse(BaseModel):
    message: str
    action: Optional[dict] = None
    sources: Optional[list] = []


@router.post("/chat")
async def chat_endpoint(request: ChatRequest):
    from agents.orchestrator import chat

    available_quarters = request.available_quarters or []

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
            logger.exception("Non-streaming chat failed")
            response = f"The AI assistant encountered an unexpected error: {str(exc)[:200]}"

        action = None
        if request.rssd_id:
            action = _build_action(
                request.question, request.rssd_id,
                request.quarter, request.period,
                available_quarters,
            )

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
                    request.question, request.rssd_id,
                    request.quarter, request.period,
                    available_quarters,
                )

            yield f"data: {json.dumps({'type': 'done', 'message': full_message, 'action': action, 'sources': ['FFIEC UBPR', 'FFIEC Call Reports']})}\n\n"

        except Exception as exc:
            logger.exception("Streaming chat failed")
            yield f"data: {json.dumps({'type': 'error', 'content': str(exc)[:200]})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )