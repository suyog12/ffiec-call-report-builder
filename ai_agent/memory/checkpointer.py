"""
checkpointer.py

Component 7: Agent Memory using LangGraph InMemorySaver.
Enables agents to remember context across conversation turns -
which bank is selected, which period, previous questions asked.
"""

from langgraph.checkpoint.memory import MemorySaver

def get_checkpointer() -> MemorySaver:
    """
    Returns a new InMemorySaver checkpointer instance.
    Each conversation thread gets its own memory via thread_id.

    Usage:
        checkpointer = get_checkpointer()
        agent = create_react_agent(llm, tools, checkpointer=checkpointer)
        config = {"configurable": {"thread_id": "session-123"}}
        agent.invoke({"messages": [...]}, config=config)
    """
    return MemorySaver()
