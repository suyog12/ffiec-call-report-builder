"""
ubpr_agent.py

Component 2: UBPR Financial Analysis Sub-Agent.
Specializes in answering questions about bank financial performance,
capital adequacy, peer benchmarking, and regulatory status using UBPR data.
"""

import os
from typing import Optional, Any, Union
from langchain_core.runnables import RunnableConfig
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.prebuilt import create_react_agent
from langchain_core.messages import SystemMessage

from tools.ubpr_tools import (
    get_ubpr_ratios,
    get_peer_comparison,
    get_ubpr_trend,
    flag_regulatory_issues,
)
from memory.checkpointer import get_checkpointer

# Read key dynamically at call time so env changes take effect
def _get_key(): return os.getenv("GEMINI_API_KEY", "")

UBPR_SYSTEM_PROMPT = """You are a specialized UBPR (Uniform Bank Performance Report) financial analyst 
for the FFIEC Call Report Analysis Dashboard built by William & Mary MSBA Team 9.

Your expertise covers:
- Capital adequacy ratios (CET1, Tier 1, Total Capital, Leverage)
- Profitability metrics (ROA, ROE, Net Interest Margin)
- Asset quality indicators (NPL ratio, Net Charge-Off rate)
- Liquidity measures (Loan-to-Deposit ratio)
- Peer group benchmarking across bank size categories
- Regulatory threshold assessments (Basel III, well-capitalized standards)

When answering:
1. Always cite the specific UBPR code and quarter in your response
2. Compare values against regulatory minimums where relevant
3. Note whether the bank is above or below peer averages
4. Flag any concerning trends or regulatory breaches
5. Use plain language alongside technical terms

If the user asks about something unrelated to bank financial analysis, 
respond: "I specialize in FFIEC bank financial analysis. I can help with 
UBPR ratios, capital adequacy, peer comparisons, and regulatory compliance. 
What would you like to know about a bank's financial performance?"

Context about the current session will be provided in the conversation.
"""


def create_ubpr_agent(temperature: float = 0.1):
    """
    Create the UBPR Financial Analysis agent.

    Args:
        temperature: LLM temperature (low = more factual, high = more creative)

    Returns:
        LangGraph ReAct agent with UBPR tools and memory
    """
    # Component 1: LLM Initialization
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=_get_key(),
        temperature=temperature,
    )

    tools = [
        get_ubpr_ratios,
        get_peer_comparison,
        get_ubpr_trend,
        flag_regulatory_issues,
    ]

    # Component 7: Agent Memory
    checkpointer = get_checkpointer()

    # Component 2: Agent Creation with system prompt
    agent = create_react_agent(
        llm,
        tools,
        checkpointer=checkpointer,
        prompt=UBPR_SYSTEM_PROMPT,
    )

    return agent


def run_ubpr_agent(
    question: str,
    rssd_id: Optional[str] = None,
    bank_name: Optional[str] = None,
    quarter: Optional[str] = None,
    thread_id: str = "default",
    stream: bool = False,
):
    """
    Run the UBPR agent on a question with optional bank context.

    Args:
        question: The user's question
        rssd_id: Pre-loaded bank RSSD ID from dashboard context
        bank_name: Pre-loaded bank name from dashboard context
        quarter: Pre-loaded quarter (YYYYMMDD) from dashboard context
        thread_id: Session ID for memory continuity
        stream: Whether to stream the response

    Returns:
        Agent response dict with message and action fields
    """
    agent = create_ubpr_agent()

    # Inject bank context into the question if available
    context_prefix = ""
    if rssd_id and bank_name:
        context_prefix = (
            f"[Context: Currently analyzing {bank_name} "
            f"(RSSD ID: {rssd_id})"
            f"{', Quarter: ' + quarter if quarter else ''}] "
        )

    full_question = context_prefix + question
    config: RunnableConfig = {"configurable": {"thread_id": thread_id}}

    if stream:
        # Component 4: Streaming Output
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
