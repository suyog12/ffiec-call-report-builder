---
name: ffiec-bank-analysis-agent
description: >
  Multi-agent system for analyzing FFIEC Call Reports and UBPR financial data.
  Trigger when users ask about bank financial performance, capital ratios,
  Call Report filings, peer benchmarking, or regulatory capital adequacy.
  Routes questions to specialized sub-agents (UBPR or Call Report) via an orchestrator.
triggers:
  - "analyze [bank name]"
  - "what is [bank]'s capital ratio"
  - "show me the call report for [bank]"
  - "compare [bank] to peers"
  - "is [bank] well capitalized"
  - "what are [bank]'s total assets"
  - "UBPR ratios for [bank]"
  - "Q[1-4] [year] report"
  - "balance sheet"
  - "ROA / ROE / NIM / NPL"
safety_guardrails:
  - Do not answer questions outside FFIEC banking and financial analysis
  - Do not hallucinate financial figures — always fetch from API tools
  - Always cite the data source (UBPR quarter or Call Report period)
  - If a period is unavailable, clearly state the nearest available period
---

## Overview

The FFIEC Bank Analysis Agent is a LangChain multi-agent system that answers 
questions about U.S. bank financial data using two data sources:

1. **UBPR (Uniform Bank Performance Reports)** — pre-calculated ratios stored 
   in Cloudflare R2 as Parquet files, queried via DuckDB
2. **FFIEC Call Reports** — quarterly regulatory filings fetched live from the 
   FFIEC CDR public API

The system uses three agents:
- **Orchestrator** — classifies intent and routes to the correct sub-agent
- **UBPR Agent** — handles ratio analysis, capital adequacy, peer benchmarking
- **Call Report Agent** — handles filing data, balance sheets, income statements

---

## Step-by-Step Instructions

### Setup

1. Copy `.env.example` to `.env` and fill in your Gemini API key and backend URL:
   ```
   GEMINI_API_KEY=your_key_here
   BACKEND_URL=https://ffiec-call-report-builder.onrender.com
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run the full demo:
   ```bash
   python main.py
   ```

4. Run interactive chat:
   ```bash
   python main.py --interactive
   ```

5. Demo a specific component:
   ```bash
   python main.py --component 8
   ```

### Dashboard Integration

Mount the chat endpoint in the existing FastAPI backend by adding to `backend/app/main.py`:
```python
import sys
sys.path.insert(0, "../ai_agent")
from server.chat_endpoint import router as agent_router
app.include_router(agent_router)
```

Then call `POST /agent/chat` from the frontend with:
```json
{
  "question": "What is this bank's ROA?",
  "rssd_id": "480228",
  "bank_name": "BANK OF AMERICA, NATIONAL ASSOCIATION",
  "quarter": "20251231",
  "period": "12/31/2025",
  "thread_id": "session-abc123",
  "stream": true
}
```

---

## Output Format

Every agent response includes:

```json
{
  "message": "Bank of America's ROA for Q4 2025 is 1.34%...",
  "action": {
    "type": "load_ubpr | load_report | none",
    "rssd_id": "480228",
    "quarter": "20251231",
    "period": "12/31/2025",
    "tab": "summary | trends | peers | pdf | sections | metrics"
  },
  "sources": ["FFIEC UBPR", "FFIEC Call Reports"]
}
```

The `action` field tells the frontend which tab to navigate to and which 
bank/period to load automatically.

---

## Rules and Edge Cases

- **Out of scope**: If asked about anything unrelated to bank financial analysis, 
  the orchestrator returns a polite refusal and lists what it can help with.

- **Period not available**: If the requested period doesn't exist (e.g., Q1 2026 
  not yet filed), the Call Report agent finds and uses the nearest available period 
  and explicitly tells the user.

- **Missing UBPR codes**: If a ratio code is not in the Parquet schema for that 
  quarter, the agent reports it as unavailable rather than returning null.

- **Bank context**: If a bank is already loaded in the dashboard, the agents use 
  that context automatically — users don't need to repeat the bank name.

- **Memory**: Each conversation thread retains context across turns via 
  InMemorySaver. A new `thread_id` starts a fresh conversation.

---

## Tools Available

| Tool | Agent | Description |
|------|-------|-------------|
| `get_ubpr_ratios` | UBPR | Fetch all UBPR ratios for a bank/quarter |
| `get_peer_comparison` | UBPR | Compare bank vs peer group averages |
| `get_ubpr_trend` | UBPR | Trend data over a date range |
| `flag_regulatory_issues` | UBPR | Check capital ratios vs Basel III thresholds |
| `get_available_periods` | Call Report | List all available filing periods |
| `get_bank_metrics` | Call Report | Key metrics from Call Report filing |
| `get_schedule_data` | Call Report | Raw schedule data (RC, RI, RC-C, etc.) |
| `get_available_schedules` | Call Report | List schedules in a filing |

See `templates/` for output format examples.
