import os
import logging
from typing import Optional
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.prebuilt import create_react_agent

from tools.ubpr_tools import (
    get_ubpr_ratios,
    get_peer_comparison,
    get_ubpr_trend,
    flag_regulatory_issues,
)
from memory.checkpointer import get_checkpointer

logger = logging.getLogger(__name__)

_UBPR_AGENT = None

UBPR_SYSTEM_PROMPT = """You are a specialized UBPR (Uniform Bank Performance Report) financial analyst \
for the FFIEC Call Report Analysis Dashboard built by William & Mary MSBA Team 9.

Your expertise covers:
- Capital adequacy ratios (CET1, Tier 1, Total Capital, Leverage)
- Profitability metrics (ROA, ROE, Net Interest Margin)
- Asset quality indicators (NPL ratio, Net Charge-Off rate)
- Liquidity measures (Loan-to-Deposit ratio)
- Peer group benchmarking across bank size categories
- Regulatory threshold assessments (Basel III, well-capitalized standards)

When answering:
1. Cite the specific UBPR code and quarter
2. Compare values against regulatory minimums where relevant
3. Note whether the bank is above or below peer averages
4. Flag any concerning trends or regulatory breaches
5. Use plain language alongside technical terms

The conversation context will include the currently selected bank name, RSSD ID, and quarter. \
Use this context directly without asking the user to repeat it.

If asked about anything unrelated to bank financial analysis, respond: \
"I specialize in FFIEC bank financial analysis. I can help with UBPR ratios, capital adequacy, \
peer comparisons, and regulatory compliance."
"""


def _get_key() -> str:
    return os.getenv("GEMINI_API_KEY", "")


def _build_ubpr_agent():
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=_get_key(),
        temperature=0.1,
    )
    return create_react_agent(
        llm,
        tools=[get_ubpr_ratios, get_peer_comparison, get_ubpr_trend, flag_regulatory_issues],
        checkpointer=get_checkpointer(),
        prompt=UBPR_SYSTEM_PROMPT,
    )


def _get_ubpr_agent():
    global _UBPR_AGENT
    if _UBPR_AGENT is None:
        _UBPR_AGENT = _build_ubpr_agent()
    return _UBPR_AGENT


def run_ubpr_agent(
    question: str,
    rssd_id: Optional[str] = None,
    bank_name: Optional[str] = None,
    quarter: Optional[str] = None,
    thread_id: str = "default",
    stream: bool = False,
):
    """
    Run the UBPR agent on a question with bank context injected as a system-level prefix.

    Args:
        question: User's question
        rssd_id: Bank RSSD ID from dashboard context
        bank_name: Bank name from dashboard context
        quarter: UBPR quarter in YYYYMMDD format
        thread_id: Session ID for memory continuity
        stream: Whether to stream the response

    Returns:
        Response string or LangGraph stream generator
    """
    agent = _get_ubpr_agent()

    context_parts = []
    if bank_name:
        context_parts.append(f"Bank: {bank_name}")
    if rssd_id:
        context_parts.append(f"RSSD ID: {rssd_id}")
    if quarter:
        context_parts.append(f"Quarter: {quarter}")

    full_question = question
    if context_parts:
        full_question = f"[Context — {', '.join(context_parts)}]\n{question}"

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