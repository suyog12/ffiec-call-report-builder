"""
orchestrator.py

Component 8: Multi-Agent Orchestrator.
Routes user questions to the appropriate sub-agent (UBPR or Call Report)
by wrapping each sub-agent as a callable tool.
Handles out-of-scope questions with a domain-specific response.
"""

import os
import json
from typing import Optional, Any, Union
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
from memory.checkpointer import get_checkpointer

# Read key dynamically at call time so env changes take effect
def _get_key(): return os.getenv("GEMINI_API_KEY", "")

# Shared context - set by the dashboard before each conversation
_session_context = {
    "rssd_id": None,
    "bank_name": None,
    "quarter": None,        # YYYYMMDD for UBPR
    "period": None,         # MM/DD/YYYY for Call Report
    "available_periods": [],
    "thread_id": "default",
}

def set_session_context(
    rssd_id: Optional[str] = None,
    bank_name: Optional[str] = None,
    quarter: Optional[str] = None,
    period: Optional[str] = None,
    available_periods: Optional[list] = None,
    thread_id: str = "default",
):
    """Update session context when user loads a bank in the dashboard."""
    global _session_context
    _session_context.update({
        "rssd_id": rssd_id,
        "bank_name": bank_name,
        "quarter": quarter,
        "period": period,
        "available_periods": available_periods or [],
        "thread_id": thread_id,
    })


@tool
def analyze_financial_performance(question: str) -> Any:
    """
    Route to the UBPR Financial Analysis agent.
    Use this for questions about financial ratios, capital adequacy,
    ROA, ROE, NIM, peer comparisons, regulatory status, or any UBPR data.

    Args:
        question: The user's financial analysis question

    Returns:
        Detailed financial analysis with ratio values and context
    """
    from agents.ubpr_agent import run_ubpr_agent
    ctx = _session_context
    return run_ubpr_agent(
        question=question,
        rssd_id=ctx["rssd_id"],
        bank_name=ctx["bank_name"],
        quarter=ctx["quarter"],
        thread_id=ctx["thread_id"] + "_ubpr",
    )


@tool
def analyze_call_report(question: str) -> Any:
    """
    Route to the Call Report agent.
    Use this for questions about Call Report filings, balance sheets,
    income statements, loan schedules, total assets/deposits/loans,
    or requests to view/load a specific report period.

    Args:
        question: The user's call report question

    Returns:
        Call Report data summary and navigation instructions
    """
    from agents.call_report_agent import run_call_report_agent
    ctx = _session_context
    return run_call_report_agent(
        question=question,
        rssd_id=ctx["rssd_id"],
        bank_name=ctx["bank_name"],
        period=ctx["period"],
        available_periods=ctx["available_periods"],
        thread_id=ctx["thread_id"] + "_call",
    )


ORCHESTRATOR_SYSTEM_PROMPT = """You are the master orchestrator for the FFIEC Call Report Analysis Dashboard,
built by William & Mary MSBA Team 9, Class of 2026.

This dashboard analyzes U.S. bank financial data from two sources:
1. FFIEC Call Reports - quarterly regulatory filings with balance sheets, income statements, loan data
2. UBPR (Uniform Bank Performance Reports) - pre-calculated financial ratios and peer comparisons

Your job is to:
1. Understand what the user is asking
2. The message will contain [Context: ...] with bank name, RSSD ID and quarter - ALWAYS use this context, never ask the user for information already provided
3. Route to the correct sub-agent:
   - Use analyze_financial_performance() for: ratios, ROA, ROE, NIM, capital, peer comparison, regulatory status, trends, CET1, leverage
   - Use analyze_call_report() for: balance sheet, income, loans, deposits, specific schedule data, loading a report period
4. Synthesize the response clearly
5. NEVER ask the user to provide the bank name, RSSD ID, or quarter if already in the context

IMPORTANT - Out of scope handling:
If the user asks about ANYTHING not related to bank financial analysis, Call Reports, or UBPR data,
respond ONLY with this exact message:
"I'm specialized in FFIEC bank financial analysis and cannot help with that. 
I can answer questions about:
• Call Report filings (balance sheets, income statements, loan data)
• UBPR financial ratios (capital, profitability, liquidity, asset quality)
• Peer group benchmarking
• Regulatory capital adequacy
What would you like to know about a bank's financial performance?"

Never attempt to answer general knowledge questions, coding questions, or anything outside banking/finance.
"""


def create_orchestrator(temperature: float = 0.1):
    """
    Create the master orchestrator agent.

    Returns:
        LangGraph ReAct agent that routes to sub-agents
    """
    # Component 1: LLM Initialization with temperature experiment
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=_get_key(),
        temperature=temperature,
    )

    tools = [
        analyze_financial_performance,
        analyze_call_report,
    ]

    checkpointer = get_checkpointer()

    # Component 8: Orchestration agent
    agent = create_react_agent(
        llm,
        tools,
        checkpointer=checkpointer,
        prompt=ORCHESTRATOR_SYSTEM_PROMPT,
    )

    return agent



# ── Simple monthly request counter ──────────────────────────────────────────
# Resets when the process restarts. For persistent tracking use a database.
_request_count = 0
_MONTHLY_REQUEST_LIMIT = 14_000  # ~$5/month at gemini-2.5-flash rates

def _check_rate_limit() -> str | None:
    """Returns an error message if monthly limit is reached, else None."""
    global _request_count
    _request_count += 1
    if _request_count > _MONTHLY_REQUEST_LIMIT:
        return (
            "Monthly usage limit reached for this dashboard. "
            "The AI assistant will resume at the start of next month. "
            "For unlimited access, contact the dashboard administrator."
        )
    return None


def _handle_llm_error(e: Exception) -> str:
    """Convert LLM API errors into user-friendly messages."""
    msg = str(e)
    if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
        return (
            "The AI assistant is temporarily unavailable due to API rate limits. "
            "This is a free-tier quota limitation and resets daily at midnight Pacific Time. "
            "Please try again later, or contact the dashboard administrator to upgrade the API plan."
        )
    if "404" in msg or "NOT_FOUND" in msg:
        return (
            "The AI model is currently unavailable. "
            "Please try again in a few moments."
        )
    if "401" in msg or "403" in msg or "API_KEY" in msg.upper():
        return (
            "Invalid or missing Gemini API key. "
            "Please check your GEMINI_API_KEY in the .env file."
        )
    return f"The AI assistant encountered an error: {msg[:200]}"

def chat(
    question: str,
    rssd_id: Optional[str] = None,
    bank_name: Optional[str] = None,
    quarter: Optional[str] = None,
    period: Optional[str] = None,
    available_periods: Optional[list] = None,
    thread_id: str = "default",
    stream: bool = False,
):
    """
    Main entry point for the chat interface.

    Args:
        question: User's question
        rssd_id: Currently loaded bank RSSD ID
        bank_name: Currently loaded bank name
        quarter: Currently loaded UBPR quarter (YYYYMMDD)
        period: Currently loaded Call Report period (MM/DD/YYYY)
        available_periods: All available Call Report periods
        thread_id: Session thread ID for memory
        stream: Whether to stream the response

    Returns:
        Response string or stream generator
    """
    # Check monthly limit before calling LLM
    limit_msg = _check_rate_limit()
    if limit_msg:
        return limit_msg

    # Update session context with dashboard state
    set_session_context(
        rssd_id=rssd_id,
        bank_name=bank_name,
        quarter=quarter,
        period=period,
        available_periods=available_periods,
        thread_id=thread_id,
    )

    agent  = create_orchestrator()
    config: RunnableConfig = {"configurable": {"thread_id": thread_id}}

    # Component 3: Message Handling
    messages = [{"role": "user", "content": question}]

    if stream:
        # Component 4: Streaming Output
        try:
            return agent.stream(
                {"messages": messages},
                config=config,
                stream_mode="messages",
            )
        except Exception as e:
            err = _handle_llm_error(e)
            def _err_stream():
                yield err, {}
            return _err_stream()
    else:
        try:
            result = agent.invoke({"messages": messages}, config=config)
            last = result["messages"][-1].content
            # Handle cases where content is a list of blocks instead of plain string
            if isinstance(last, list):
                last = " ".join(b.get("text", "") for b in last if isinstance(b, dict))
            return last
        except Exception as e:
            import traceback
            print(f"[AGENT ERROR] {type(e).__name__}: {e}")
            traceback.print_exc()
            return _handle_llm_error(e)
