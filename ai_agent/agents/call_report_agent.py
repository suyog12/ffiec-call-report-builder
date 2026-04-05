"""
call_report_agent.py

Component 2: Call Report Sub-Agent.
Specializes in answering questions about FFIEC Call Report filings -
balance sheets, income statements, loan schedules, and PDF reports.
"""

import os
from typing import Optional, Any, Union
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

# Read key dynamically at call time so env changes take effect
def _get_key(): return os.getenv("GEMINI_API_KEY", "")

CALL_REPORT_SYSTEM_PROMPT = """You are a specialized FFIEC Call Report analyst 
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
4. If a period is not available, clearly state what the nearest available period is
5. When showing the report, specify which tab/schedule to navigate to

Reporting period format: MM/DD/YYYY (e.g., 12/31/2025 for Q4 2025)

If the user asks about something unrelated to FFIEC Call Reports or bank financials,
respond: "I specialize in FFIEC Call Report analysis. I can help with balance sheets, 
income statements, loan schedules, and financial metrics from bank filings. 
What would you like to know?"

Context about the current session will be provided in the conversation.
"""


def create_call_report_agent(temperature: float = 0.1):
    """
    Create the Call Report analysis agent.

    Args:
        temperature: LLM temperature

    Returns:
        LangGraph ReAct agent with Call Report tools and memory
    """
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=_get_key(),
        temperature=temperature,
    )

    tools = [
        get_available_periods,
        get_bank_metrics,
        get_schedule_data,
        get_available_schedules,
    ]

    checkpointer = get_checkpointer()

    agent = create_react_agent(
        llm,
        tools,
        checkpointer=checkpointer,
        prompt=CALL_REPORT_SYSTEM_PROMPT,
    )

    return agent


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
    Run the Call Report agent on a question with optional bank context.

    Args:
        question: The user's question
        rssd_id: Pre-loaded bank RSSD ID from dashboard context
        bank_name: Pre-loaded bank name
        period: Pre-loaded period (MM/DD/YYYY) from dashboard context
        available_periods: List of all available periods for smart resolution
        thread_id: Session ID for memory continuity
        stream: Whether to stream the response

    Returns:
        Agent response string or stream
    """
    agent = create_call_report_agent()

    # Smart period resolution if a period reference is in the question
    period_keywords = ["quarter", "q1", "q2", "q3", "q4", "2024", "2025", "2023",
                       "january", "march", "june", "september", "december", "last", "this"]
    needs_resolution = any(kw in question.lower() for kw in period_keywords)

    resolved_period = period
    resolution_note = ""
    if needs_resolution and available_periods:
        resolved = resolve_period(question, available_periods)
        resolved_period = resolved["ffiec"]
        if not resolved["exact_match"] and resolved["nearest_match"]:
            resolution_note = (
                f"\n[Note: Exact period not available. "
                f"Showing nearest available: {resolved['nearest_match']}]"
            )

    context_prefix = ""
    if rssd_id and bank_name:
        context_prefix = (
            f"[Context: Currently analyzing {bank_name} "
            f"(RSSD ID: {rssd_id})"
            f"{', Period: ' + resolved_period if resolved_period else ''}] "
        )

    full_question = context_prefix + question + resolution_note
    config: RunnableConfig = {"configurable": {"thread_id": thread_id}}

    if stream:
        return agent.stream(
            {"messages": [{"role": "user", "content": full_question}]},
            config=config,
            stream_mode="messages",
        )
    else:
        result = agent.invoke(
            {"messages": [{"role": "user", "content": full_question}]},
            config=config,
        )
        return result["messages"][-1].content
