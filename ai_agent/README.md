# FFIEC AI Multi-Agent System

LangChain multi-agent system for the FFIEC Call Report Analysis Dashboard.  
**William & Mary MSBA Team 9 · Class of 2026**

---

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Set up environment
cp .env.example .env
# Edit .env — add your GEMINI_API_KEY

# 3. Run full demo (Gradescope submission)
python main.py

# 4. Interactive chat
python main.py --interactive

# 5. Demo specific component (1-8)
python main.py --component 8
```

---

## Structure

```
ai_agent/
├── main.py                    # Gradescope entry point — demos all 8 components
├── agents/
│   ├── orchestrator.py        # Routes questions to sub-agents
│   ├── ubpr_agent.py          # UBPR ratio + capital analysis
│   └── call_report_agent.py   # Call Report filings + metrics
├── tools/
│   ├── ubpr_tools.py          # 4 UBPR API tools
│   ├── call_report_tools.py   # 4 Call Report API tools
│   └── period_resolver.py     # Smart date/quarter resolution
├── memory/
│   └── checkpointer.py        # InMemorySaver for conversation memory
├── server/
│   └── chat_endpoint.py       # POST /agent/chat for dashboard integration
└── skill-folder/              # Gradescope skill folder deliverable
```

---

## Dashboard Integration

Add to `backend/app/main.py`:
```python
import sys
sys.path.insert(0, "../ai_agent")
from server.chat_endpoint import router as agent_router
app.include_router(agent_router)
```

Frontend calls `POST /agent/chat` with bank context from the dashboard.

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key from aistudio.google.com |
| `BACKEND_URL` | FFIEC backend URL (local or deployed on Render) |
