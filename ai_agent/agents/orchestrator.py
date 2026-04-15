"""
orchestrator.py

Three routing paths:

  1. Out-of-scope  (weather, sports, cooking…)
       → canned reply, zero API calls

  2. Data question  (anything answerable from UBPR / Call Report APIs)
       → LangGraph ReAct agent + LangChain tools
       → Tools call UBPRService / ReportService directly (in-process, no HTTP)
       → Gemini is used only to decide which tool to call and format the answer

  3. Financial knowledge  (explain CET1, what is Basel III, how is ROA calculated…)
       → Gemini called directly, no tools
       → Only when no bank data is needed at all

Rule: if the answer exists in our application data → tools answer it.
Gemini is the last resort for knowledge-only questions.
"""

import os
import logging
from dotenv import load_dotenv
load_dotenv(override=False)

from typing import Any, Iterator, Optional
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.prebuilt import create_react_agent
from memory.checkpointer import get_checkpointer

logger = logging.getLogger(__name__)

_DATA_AGENT = None
_request_count = 0
_MONTHLY_REQUEST_LIMIT = 14_000

# ── Keyword sets ──────────────────────────────────────────────────────────────

_DATA_KEYWORDS = frozenset([
    "ratio", "roa", "roe", "nim", "net interest margin", "return on assets",
    "return on equity", "capital", "cet1", "tier 1", "tier1", "leverage",
    "peer", "benchmark", "compare", "well-capitalized", "adequately capitalized",
    "undercapitalized", "regulatory", "ubpr", "charge-off", "npl",
    "nonperforming", "non-performing", "loan-to-deposit", "liquidity",
    "profitability", "asset quality", "trend", "over time", "historical",
    "balance sheet", "income statement", "schedule rc", "schedule ri",
    "schedule rc-c", "total assets", "total deposits", "total loans",
    "net income", "equity", "filing", "call report", "period", "report",
    "facsimile", "deposits", "loans", "assets", "metrics", "performance",
    "show me", "what is this bank", "this bank", "for this bank",
    "show the", "show trend", "show ratio",
])

_KNOWLEDGE_KEYWORDS = frozenset([
    "what is basel", "what is cet1", "what is tier 1", "what is leverage ratio",
    "explain ", "define ", "what does ", "how is roa", "how is roe", "how is nim",
    "difference between", "tell me about basel", "what are capital requirements",
    "how does capital", "why is capital ratio", "meaning of",
    "what is a call report", "what is ubpr", "what is ffiec",
])

_OUT_OF_SCOPE_KEYWORDS = frozenset([
    "weather", "recipe", "sports score", "movie", "music", "song lyrics",
    "joke", "politics", "travel destination", "hotel booking", "flight",
    "stock price", "crypto", "bitcoin", "write me a poem", "write an essay",
    "translate this", "who are you", "what are you",
])

_OUT_OF_SCOPE_REPLY = (
    "I am specialized in FFIEC bank financial analysis and cannot help with that. "
    "I can answer questions about Call Report filings, UBPR financial ratios, "
    "peer group benchmarking, regulatory capital adequacy, and general banking concepts."
)

_KNOWLEDGE_SYSTEM_PROMPT = (
    "You are an expert in U.S. bank regulatory reporting and financial analysis. "
    "Answer the user's question about banking concepts, regulations, or financial metrics "
    "clearly and concisely. Focus on FFIEC, UBPR, Call Reports, Basel III, and related topics. "
    "Keep answers under 200 words unless detail is essential."
)

_DATA_AGENT_PROMPT = """You are an expert FFIEC financial analyst assistant for the FFIEC Call Report \
Analysis Dashboard built by William & Mary MSBA Team 9.

You have tools to fetch real bank data. ALWAYS use tools to answer — never guess or invent numbers.

Available tools:
- get_ubpr_ratios: all UBPR financial ratios for a bank/quarter (ROA, ROE, NIM, CET1, etc.)
- get_peer_comparison: compare bank ratios vs peer group averages
- get_ubpr_trend: trend data across quarters for any metric
- flag_regulatory_issues: Basel III capital adequacy status
- get_bank_metrics: Call Report key financials (assets, loans, deposits, equity, net income)
- get_schedule_data: detailed Call Report schedule line items (RC, RI, RC-C)
- get_available_schedules: list available schedules in a filing
- get_available_periods: list available reporting periods

The user's message starts with [Context — Bank: ..., RSSD ID: ..., Quarter: ...].
Always use this context when calling tools. Do not ask the user to repeat it.

Format answers clearly. Include metric names, values, and units.
For regulatory status always state: well-capitalized, adequately capitalized, or undercapitalized.
"""

_SESSION_CONTEXT: dict = {
    "rssd_id": None,
    "bank_name": None,
    "quarter": None,
    "period": None,
    "available_periods": [],
    "thread_id": "default",
}


def _get_key() -> str:
    return os.getenv("GEMINI_API_KEY", "")


def _route(question: str, rssd_id: Optional[str]) -> str:
    """Return 'out_of_scope' | 'data' | 'knowledge'."""
    q = question.lower()
    if any(kw in q for kw in _OUT_OF_SCOPE_KEYWORDS):
        return "out_of_scope"
    if any(kw in q for kw in _DATA_KEYWORDS):
        return "data"
    if any(kw in q for kw in _KNOWLEDGE_KEYWORDS):
        return "knowledge"
    # If bank context is present, default to data — user is asking about a specific bank
    if rssd_id:
        return "data"
    return "knowledge"


def _build_data_agent():
    from tools.ubpr_tools import (  # noqa: PLC0415
        get_ubpr_ratios, get_peer_comparison, get_ubpr_trend, flag_regulatory_issues,
    )
    from tools.call_report_tools import (  # noqa: PLC0415
        get_available_periods, get_bank_metrics, get_schedule_data, get_available_schedules,
    )
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=_get_key(),
        temperature=0.0,
    )
    return create_react_agent(
        llm,
        tools=[
            get_ubpr_ratios, get_peer_comparison, get_ubpr_trend, flag_regulatory_issues,
            get_available_periods, get_bank_metrics, get_schedule_data, get_available_schedules,
        ],
        checkpointer=get_checkpointer(),
        prompt=_DATA_AGENT_PROMPT,
    )


def _get_data_agent():
    global _DATA_AGENT
    if _DATA_AGENT is None:
        _DATA_AGENT = _build_data_agent()
    return _DATA_AGENT


def set_session_context(
    rssd_id: Optional[str] = None,
    bank_name: Optional[str] = None,
    quarter: Optional[str] = None,
    period: Optional[str] = None,
    available_periods: Optional[list] = None,
    thread_id: str = "default",
) -> None:
    global _SESSION_CONTEXT
    _SESSION_CONTEXT.update({
        "rssd_id": rssd_id,
        "bank_name": bank_name,
        "quarter": quarter,
        "period": period,
        "available_periods": available_periods or [],
        "thread_id": thread_id,
    })


def _check_rate_limit() -> Optional[str]:
    global _request_count
    _request_count += 1
    if _request_count > _MONTHLY_REQUEST_LIMIT:
        return (
            "Monthly usage limit reached for this dashboard. "
            "The AI assistant will resume at the start of next month."
        )
    return None


def _handle_error(exc: Exception) -> str:
    msg = str(exc)
    if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
        return (
            "The AI assistant is temporarily unavailable due to API quota limits. "
            "Please try again in a few moments."
        )
    if "404" in msg or "NOT_FOUND" in msg:
        return "The AI model is currently unavailable. Please try again shortly."
    if "401" in msg or "403" in msg or "API_KEY" in msg.upper():
        return "Invalid or missing Gemini API key. Please check your GEMINI_API_KEY configuration."
    logger.error("LLM error: %s", msg[:300])
    return f"The AI assistant encountered an error: {msg[:200]}"


def _build_context_message(
    question: str,
    rssd_id: Optional[str],
    bank_name: Optional[str],
    quarter: Optional[str],
    period: Optional[str],
) -> str:
    parts = []
    if bank_name:
        parts.append(f"Bank: {bank_name}")
    if rssd_id:
        parts.append(f"RSSD ID: {rssd_id}")
    if quarter:
        parts.append(f"Quarter: {quarter}")
    if period:
        parts.append(f"Period: {period}")
    if parts:
        return f"[Context — {', '.join(parts)}]\n{question}"
    return question


def chat(
    question: str,
    rssd_id: Optional[str] = None,
    bank_name: Optional[str] = None,
    quarter: Optional[str] = None,
    period: Optional[str] = None,
    available_periods: Optional[list] = None,
    thread_id: str = "default",
    stream: bool = False,
) -> Any:
    limit_msg = _check_rate_limit()
    if limit_msg:
        return limit_msg

    set_session_context(
        rssd_id=rssd_id, bank_name=bank_name,
        quarter=quarter, period=period,
        available_periods=available_periods,
        thread_id=thread_id,
    )

    route = _route(question, rssd_id)
    logger.debug("Route: %s | thread: %s | q: %s", route, thread_id, question[:80])

    # ── 1. Out of scope ───────────────────────────────────────────────────────
    if route == "out_of_scope":
        return _OUT_OF_SCOPE_REPLY

    # ── 2. Data question → LangGraph + tools ─────────────────────────────────
    if route == "data":
        agent = _get_data_agent()
        msg = _build_context_message(question, rssd_id, bank_name, quarter, period)
        config: RunnableConfig = {
            "configurable": {"thread_id": thread_id},
            "recursion_limit": 6,
        }
        if stream:
            try:
                return agent.stream(
                    {"messages": [{"role": "user", "content": msg}]},
                    config=config,
                    stream_mode="messages",
                )
            except Exception as exc:
                err = _handle_error(exc)
                def _err_stream() -> Iterator[tuple]:
                    yield err, {}
                return _err_stream()
        try:
            result = agent.invoke(
                {"messages": [{"role": "user", "content": msg}]},
                config=config,
            )
            content = result["messages"][-1].content
            if isinstance(content, list):
                return " ".join(b.get("text", "") for b in content if isinstance(b, dict))
            return content
        except Exception as exc:
            return _handle_error(exc)

    # ── 3. Financial knowledge → Gemini directly, no tools ───────────────────
    try:
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash",
            google_api_key=_get_key(),
            temperature=0.1,
        )
        messages = [
            SystemMessage(content=_KNOWLEDGE_SYSTEM_PROMPT),
            HumanMessage(content=question),
        ]
        response = llm.invoke(messages)
        content = response.content
        if isinstance(content, list):
            return " ".join(b.get("text", "") for b in content if isinstance(b, dict))
        return content
    except Exception as exc:
        return _handle_error(exc)