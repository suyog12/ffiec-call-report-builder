# FFIEC Bank Analysis Multi-Agent System — Design Rationale

**William & Mary MSBA Team 9 · Class of 2026**  
**AI Team Assignment 5**

---

## System Overview

We built a multi-agent AI system on top of the FFIEC Call Report Analysis Dashboard — 
a full-stack web application that analyzes U.S. bank regulatory filings. The system 
routes natural language questions to specialized sub-agents, each equipped with tools 
that call our deployed backend API.

---

## Architecture Decisions

**Why two sub-agents instead of one?**  
Our data has two fundamentally different sources: FFIEC Call Reports (live API, 
quarterly filings) and UBPR data (pre-ingested Parquet files in Cloudflare R2 queried 
via DuckDB). Each requires different tools, different period formats, and different 
domain expertise. Separating them into a UBPR Agent and a Call Report Agent keeps 
each agent focused and its system prompt tight — a single generalist agent would 
require an overloaded prompt and produce lower quality responses.

**Why an orchestrator pattern?**  
The orchestrator wraps each sub-agent as a callable LangChain tool, satisfying 
Component 8 while keeping routing logic centralized. The orchestrator classifies 
intent using the LLM's reasoning rather than brittle keyword matching, making it 
robust to paraphrasing and mixed queries.

**Why Gemini 1.5 Flash?**  
It is available via free API key (Google AI Studio), fast enough for streaming 
responses in a web UI, and accurate enough for structured financial reasoning. 
Temperature is set to 0.1 for factual financial queries — low enough to minimize 
hallucination risk while allowing natural language generation.

**Why InMemorySaver for memory?**  
The dashboard already knows which bank is loaded — the agent just needs to remember 
that context across conversational turns. InMemorySaver keyed by thread_id provides 
exactly this: persistent context per user session without requiring a database.

**Domain restriction design**  
The orchestrator system prompt explicitly instructs the LLM to return a fixed 
refusal message for out-of-scope queries. This is enforced at the orchestrator level 
before any sub-agent is invoked, ensuring no financial hallucinations and no 
unrelated answers.

---

## Component Mapping

| # | Component | Implementation |
|---|-----------|---------------|
| 1 | LLM Init | `ChatGoogleGenerativeAI` with temperature 0.0 and 0.9 demonstrated |
| 2 | Agent Creation | `create_react_agent` for UBPR Agent and Call Report Agent |
| 3 | Message Handling | Multi-turn `HumanMessage`/`AIMessage` sequences |
| 4 | Streaming | `agent.stream()` with `stream_mode="messages"` via SSE |
| 5 | Custom Tools | 8 tools with `@tool` decorator, docstrings, typed params |
| 6 | External API | All tools call `https://ffiec-call-report-builder.onrender.com` |
| 7 | Agent Memory | `InMemorySaver` checkpointer with `thread_id` per session |
| 8 | Orchestration | Orchestrator wraps sub-agents as tools, delegates and synthesizes |

---

## Dual-Use Design

The `ai_agent/` folder is self-contained — it can be zipped and submitted to 
Gradescope or mounted as a module in the production FastAPI backend via 
`server/chat_endpoint.py`. The same agents, tools, and memory system power both 
the CLI demo and the live dashboard chat interface.
