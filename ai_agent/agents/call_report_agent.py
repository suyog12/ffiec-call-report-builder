import os
import logging
from typing import Optional
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.prebuilt import create_react_agent

from tools.call_report_tools import (
    get_available_periods,
    get_bank_metrics,
    get_schedule_data,
    get_available_schedules,
)
from tools.period_resolver import resolve_period
from memory.checkpointer import get_checkpointer

logger = logging.getLogger(__name__)

_CALL_REPORT_AGENT = None

CALL_REPORT_SYSTEM_PROMPT = """You are a specialized FFIEC Call Report analyst \
for the FFIEC Call Report Analysis Dashboard built by William & Mary MSBA Team 9.

Your expertise covers:
- Balance Sheet data (Schedule RC)
- Income Statement data (Schedule RI)
- Loan and Lease data (Schedule RC-C)
- Key financial metrics: total assets, loans, deposits, equity, net income
- Ratio analysis: equity-to-assets, loans-to-deposits

When answering:
1. Always specify the reporting period you are referencing
2. Format dollar values clearly (e.g., $1.5T, $250B, $45M)
3. Explain what line items mean in plain language
4. If a period is not available, clearly state the nearest available period

Reporting period format: MM/DD/YYYY (e.g., 12/31/2025 for Q4 2025)

The conversation context will include the currently selected bank name, RSSD ID, and period. \
Use this context directly without asking the user to repeat it.

If asked about anything unrelated to FFIEC Call Reports or bank financials, respond: \
"I specialize in FFIEC Call Report analysis. I can help with balance sheets, income statements, \
loan schedules, and financial metrics from bank filings."
"""

_PERIOD_KEYWORDS = frozenset([
    "quarter", "q1", "q2", "q3", "q4", "2023", "2024", "2025", "2026",
    "january", "march", "june", "september", "december", "last", "this",
])


def _get_key() -> str:
    return os.getenv("GEMINI_API_KEY", "")


def _build_call_report_agent():
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=_get_key(),
        temperature=0.1,
    )
    return create_react_agent(
        llm,
        tools=[get_available_periods, get_bank_metrics, get_schedule_data, get_available_schedules],
        checkpointer=get_checkpointer(),
        prompt=CALL_REPORT_SYSTEM_PROMPT,
    )


def _get_call_report_agent():
    global _CALL_REPORT_AGENT
    if _CALL_REPORT_AGENT is None:
        _CALL_REPORT_AGENT = _build_call_report_agent()
    return _CALL_REPORT_AGENT


def run_call_report_agent(
    question: str,
    rssd_id: Optional[str] = None,
    bank_name: Optional[str] = None,
    period: Optional[str] = None,
    available_periods: Optional[list] = None,
    thread_id: str = "default",
    stream: bool = False,
):
    """
    Run the Call Report agent on a question with bank context injected as a prefix.

    Args:
        question: User's question
        rssd_id: Bank RSSD ID from dashboard context
        bank_name: Bank name from dashboard context
        period: Call Report period in MM/DD/YYYY format
        available_periods: All available periods for smart resolution
        thread_id: Session ID for memory continuity
        stream: Whether to stream the response

    Returns:
        Response string or LangGraph stream generator
    """
    agent = _get_call_report_agent()

    resolved_period = period
    resolution_note = ""
    question_lower = question.lower()
    if any(kw in question_lower for kw in _PERIOD_KEYWORDS) and available_periods:
        resolved = resolve_period(question, available_periods)
        resolved_period = resolved["ffiec"]
        if not resolved["exact_match"] and resolved["nearest_match"]:
            resolution_note = (
                f"\n[Note: Exact period not available. "
                f"Nearest available: {resolved['nearest_match']}]"
            )

    context_parts = []
    if bank_name:
        context_parts.append(f"Bank: {bank_name}")
    if rssd_id:
        context_parts.append(f"RSSD ID: {rssd_id}")
    if resolved_period:
        context_parts.append(f"Period: {resolved_period}")

    full_question = question + resolution_note
    if context_parts:
        full_question = f"[Context — {', '.join(context_parts)}]\n{full_question}"

    config: RunnableConfig = {
        "configurable": {"thread_id": thread_id},
        "recursion_limit": 6,
    }

    if stream:
        return agent.stream(
            {"messages": [{"role": "user", "content": full_question}]},
            config=config,
            stream_mode="messages",
        )

    result = agent.invoke(
        {"messages": [{"role": "user", "content": full_question}]},
        config=config,
    )
    content = result["messages"][-1].content
    if isinstance(content, list):
        return " ".join(b.get("text", "") for b in content if isinstance(b, dict))
    return content