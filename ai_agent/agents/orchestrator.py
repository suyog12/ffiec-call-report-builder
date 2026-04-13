import os
import logging
from dotenv import load_dotenv
load_dotenv()
from typing import TYPE_CHECKING, Any, Iterator, Optional, Union, cast
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
from memory.checkpointer import get_checkpointer

if TYPE_CHECKING:
    from agents.ubpr_agent import run_ubpr_agent
    from agents.call_report_agent import run_call_report_agent

logger = logging.getLogger(__name__)

_ORCHESTRATOR_AGENT = None
_request_count = 0
_MONTHLY_REQUEST_LIMIT = 14_000

_UBPR_KEYWORDS = frozenset([
    "ratio", "roa", "roe", "nim", "net interest margin", "return on",
    "capital", "cet1", "tier 1", "tier1", "leverage", "peer", "benchmark",
    "regulatory", "well-capitalized", "adequately capitalized", "ubpr",
    "charge-off", "npl", "nonperforming", "loan-to-deposit", "liquidity",
    "profitability", "asset quality",
])

_CALL_REPORT_KEYWORDS = frozenset([
    "balance sheet", "income statement", "schedule rc", "schedule ri",
    "schedule rc-c", "total assets", "total deposits", "total loans",
    "net income", "equity", "filing", "call report", "period", "report",
    "load", "view", "show", "open", "facsimile", "pdf",
])

_SESSION_CONTEXT: dict = {
    "rssd_id": None,
    "bank_name": None,
    "quarter": None,
    "period": None,
    "available_periods": [],
    "thread_id": "default",
}

ORCHESTRATOR_SYSTEM_PROMPT = (
    "You are the master orchestrator for the FFIEC Call Report Analysis Dashboard "
    "built by William & Mary MSBA Team 9, Class of 2026.\n\n"
    "This dashboard analyzes U.S. bank financial data from two sources:\n"
    "1. FFIEC Call Reports — quarterly regulatory filings with balance sheets, income statements, loan data\n"
    "2. UBPR — pre-calculated financial ratios and peer comparisons\n\n"
    "Your job:\n"
    "1. Understand what the user is asking\n"
    "2. The message will contain [Context — ...] with bank name, RSSD ID and quarter. Always use this context.\n"
    "3. Route to the correct sub-agent:\n"
    "   - analyze_financial_performance: ratios, ROA, ROE, NIM, capital, peer comparison, regulatory status, trends\n"
    "   - analyze_call_report: balance sheet, income, loans, deposits, specific schedule data, report periods\n"
    "4. Synthesize the response clearly\n"
    "5. Never ask the user to provide bank name, RSSD ID, or quarter if already in the context\n\n"
    "If the user asks about anything not related to bank financial analysis, Call Reports, or UBPR data, "
    "respond only with: \"I am specialized in FFIEC bank financial analysis and cannot help with that. "
    "I can answer questions about Call Report filings, UBPR financial ratios, peer group benchmarking, "
    "and regulatory capital adequacy.\""
)


def _get_key() -> str:
    return os.getenv("GEMINI_API_KEY", "")


def _route_by_keyword(question: str) -> Optional[str]:
    """
    Classify the question as 'ubpr', 'call_report', or None using keyword matching.
    Returns None when the question is ambiguous and requires LLM routing.
    """
    q = question.lower()
    ubpr_score = sum(1 for kw in _UBPR_KEYWORDS if kw in q)
    call_score = sum(1 for kw in _CALL_REPORT_KEYWORDS if kw in q)
    if ubpr_score == call_score:
        return None
    return "ubpr" if ubpr_score > call_score else "call_report"


@tool
def analyze_financial_performance(question: str) -> str:
    """
    Route to the UBPR Financial Analysis agent.
    Use for: financial ratios, capital adequacy, ROA, ROE, NIM,
    peer comparisons, regulatory status, trends, CET1, leverage.

    Args:
        question: The user's financial analysis question

    Returns:
        Detailed financial analysis with ratio values and context
    """
    from agents.ubpr_agent import run_ubpr_agent as _run_ubpr  # noqa: PLC0415
    ctx = _SESSION_CONTEXT
    return cast(str, _run_ubpr(
        question=question,
        rssd_id=ctx["rssd_id"],
        bank_name=ctx["bank_name"],
        quarter=ctx["quarter"],
        thread_id=ctx["thread_id"] + "_ubpr",
    ))


@tool
def analyze_call_report(question: str) -> str:
    """
    Route to the Call Report agent.
    Use for: balance sheet, income, loans, deposits, specific
    schedule data, loading a report period, filing data.

    Args:
        question: The user's call report question

    Returns:
        Call Report data summary and navigation instructions
    """
    from agents.call_report_agent import run_call_report_agent as _run_cr  # noqa: PLC0415
    ctx = _SESSION_CONTEXT
    return cast(str, _run_cr(
        question=question,
        rssd_id=ctx["rssd_id"],
        bank_name=ctx["bank_name"],
        period=ctx["period"],
        available_periods=ctx["available_periods"],
        thread_id=ctx["thread_id"] + "_call",
    ))


def _build_orchestrator():
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=_get_key(),
        temperature=0.1,
    )
    return create_react_agent(
        llm,
        tools=[analyze_financial_performance, analyze_call_report],
        checkpointer=get_checkpointer(),
        prompt=ORCHESTRATOR_SYSTEM_PROMPT,
    )


def _get_orchestrator():
    global _ORCHESTRATOR_AGENT
    if _ORCHESTRATOR_AGENT is None:
        _ORCHESTRATOR_AGENT = _build_orchestrator()
    return _ORCHESTRATOR_AGENT


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


def _handle_llm_error(exc: Exception) -> str:
    msg = str(exc)
    if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
        return (
            "The AI assistant is temporarily unavailable due to API rate limits. "
            "This is a free-tier quota limitation that resets daily at midnight Pacific Time."
        )
    if "404" in msg or "NOT_FOUND" in msg:
        return "The AI model is currently unavailable. Please try again in a few moments."
    if "401" in msg or "403" in msg or "API_KEY" in msg.upper():
        return "Invalid or missing Gemini API key. Please check your GEMINI_API_KEY configuration."
    logger.error("LLM error: %s", msg[:300])
    return f"The AI assistant encountered an error: {msg[:200]}"


def _build_user_message(
    question: str,
    rssd_id: Optional[str],
    bank_name: Optional[str],
    quarter: Optional[str],
    period: Optional[str],
) -> str:
    context_parts = []
    if bank_name:
        context_parts.append(f"Bank: {bank_name}")
    if rssd_id:
        context_parts.append(f"RSSD ID: {rssd_id}")
    if quarter:
        context_parts.append(f"Quarter: {quarter}")
    if period:
        context_parts.append(f"Period: {period}")
    if context_parts:
        return f"[Context — {', '.join(context_parts)}]\n{question}"
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
    """
    Main entry point for the chat interface.

    Routes directly to the appropriate sub-agent via keyword matching when unambiguous,
    falling back to the LLM orchestrator for ambiguous queries. Both paths use the same
    singleton agents and shared MemorySaver checkpointer.

    Args:
        question: User's question
        rssd_id: Currently loaded bank RSSD ID
        bank_name: Currently loaded bank name
        quarter: UBPR quarter in YYYYMMDD format
        period: Call Report period in MM/DD/YYYY format
        available_periods: All available Call Report periods
        thread_id: Session thread ID for memory
        stream: Whether to stream the response

    Returns:
        Response string or LangGraph stream generator
    """
    limit_msg = _check_rate_limit()
    if limit_msg:
        return limit_msg

    set_session_context(
        rssd_id=rssd_id,
        bank_name=bank_name,
        quarter=quarter,
        period=period,
        available_periods=available_periods,
        thread_id=thread_id,
    )

    route = _route_by_keyword(question)

    if route == "ubpr":
        from agents.ubpr_agent import run_ubpr_agent as _run_ubpr  # noqa: PLC0415
        logger.debug("Keyword router: UBPR path for thread %s", thread_id)
        try:
            return _run_ubpr(
                question=question,
                rssd_id=rssd_id,
                bank_name=bank_name,
                quarter=quarter,
                thread_id=thread_id + "_ubpr",
                stream=stream,
            )
        except Exception as exc:
            return _handle_llm_error(exc)

    if route == "call_report":
        from agents.call_report_agent import run_call_report_agent as _run_cr  # noqa: PLC0415
        logger.debug("Keyword router: Call Report path for thread %s", thread_id)
        try:
            return _run_cr(
                question=question,
                rssd_id=rssd_id,
                bank_name=bank_name,
                period=period,
                available_periods=available_periods,
                thread_id=thread_id + "_call",
                stream=stream,
            )
        except Exception as exc:
            return _handle_llm_error(exc)

    logger.debug("Keyword router: ambiguous, falling back to orchestrator for thread %s", thread_id)
    agent = _get_orchestrator()
    user_message = _build_user_message(question, rssd_id, bank_name, quarter, period)
    config: RunnableConfig = {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": 8,
    }

    if stream:
        try:
            return agent.stream(
                {"messages": [{"role": "user", "content": user_message}]},
                config=config,
                stream_mode="messages",
            )
        except Exception as exc:
            err = _handle_llm_error(exc)
            def _err_stream() -> Iterator[tuple[str, dict]]:
                yield err, {}
            return _err_stream()

    try:
        result = agent.invoke(
            {"messages": [{"role": "user", "content": user_message}]},
            config=config,
        )
        content = result["messages"][-1].content
        if isinstance(content, list):
            return " ".join(b.get("text", "") for b in content if isinstance(b, dict))
        return content
    except Exception as exc:
        logger.exception("Orchestrator invoke failed for thread %s", thread_id)
        return _handle_llm_error(exc)