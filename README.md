# FFIEC Call Report Analysis Dashboard

A full-stack financial analytics platform for exploring FFIEC Call Report filings and UBPR bank performance data, with an AI-powered chatbot assistant. Built by William & Mary MSBA Team 9, Class of 2026.

**Live demo:** https://ffiec-call-report-builder.vercel.app/

---

## What it does

**Call Reports** — Search any FFIEC-reporting institution, load quarterly SDF filings, explore schedule data, view PDF facsimiles, and export custom pivot reports as CSV or PDF.

**Financial Analysis (UBPR)** — View 10 priority ratios with regulatory threshold alerts, chart 8-quarter performance trends, benchmark against size-based peer groups, compare up to 4 institutions side-by-side, and build custom ratio formulas from the full UBPR field set.

**AI Assistant (FFIEC Assistant)** — A context-aware chatbot that answers questions about any loaded bank using real data from the platform APIs. It routes questions to the correct data source, returns structured answers, and navigates the dashboard to the relevant tab automatically.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 5 — deployed on Vercel |
| Backend | FastAPI, Python 3.11 — deployed on Render |
| Big Data Ingestion | PySpark 3.5.1, Hadoop S3A, GitHub Actions |
| Big Data Query | DuckDB httpfs |
| Storage | Cloudflare R2 — Parquet, partitioned by year/quarter |
| Call Report source | FFIEC CDR Public API |
| AI | LangChain, LangGraph, Google Gemini 2.0 Flash |

---

## Architecture

### Call Report flow
```
FFIEC CDR API → ffiec_client.py → sdf_parser.py → report_service.py → /reports/* → frontend
```

### UBPR flow
```
FFIEC UBPR API
      ↓
ubpr_ingest.py  (PySpark — GitHub Actions Ubuntu runner)
      ↓
Cloudflare R2   (Parquet — ubpr/year={YYYY}/quarter={YYYYMMDD}/data.parquet)
      ↓
query_engine.py (DuckDB httpfs — columnar pushdown, LRU cache)
      ↓
ubpr_service.py → /ubpr/* → frontend
```

### AI Agent flow
```
User question
      ↓
chat_endpoint.py  (FastAPI route — /agent/chat)
      ↓
orchestrator.py   (3-way keyword router)
      ├── Data question     → LangGraph ReAct agent + LangChain tools
      │                        → UBPRService / ReportService (in-process, no HTTP)
      │                        → Gemini formats the answer from tool output
      ├── Knowledge question → Gemini directly (explain CET1, what is Basel III, etc.)
      └── Out-of-scope       → Canned reply (zero API calls)
```

DuckDB reads only the requested columns and the matching `rssd_id` row — no full table scans. An in-process LRU cache (1-hour TTL, 256 entries) keeps repeated requests under 200ms without hitting R2 again.

PySpark runs on GitHub Actions Linux runners — this sidesteps the Windows WinUtils/`HADOOP_HOME` dependency that makes local PySpark setup impractical on Windows. The workflow installs the Hadoop S3A JARs automatically and writes Parquet directly to R2 via the S3A connector.

---

## AI Assistant

The FFIEC Assistant chatbot is embedded in the dashboard and answers questions about any bank loaded in the current session.

### Routing logic

| Question type | Example | How it's answered |
|---|---|---|
| UBPR data | "What is the CET1 ratio?" | LangGraph + `get_ubpr_ratios` tool |
| Regulatory status | "Is this bank well-capitalized?" | LangGraph + `flag_regulatory_issues` tool |
| Peer comparison | "Compare capital ratios to peers" | LangGraph + `get_peer_comparison` tool |
| Trend data | "Show NPL trend from Q3 2023 to Q3 2025" | LangGraph + `get_ubpr_trend` tool → navigates to Performance Trends tab |
| Call Report metrics | "What are total deposits?" | LangGraph + `get_bank_metrics` tool |
| Schedule data | "Show me Schedule RC" | LangGraph + `get_schedule_data` tool |
| Financial knowledge | "What is Basel III?" | Gemini directly, no tools |
| Out of scope | "What is the weather?" | Canned reply, zero API calls |

### Dashboard navigation

After answering, the chatbot automatically navigates the dashboard to the relevant section:

| Answer type | Navigation |
|---|---|
| UBPR ratios / regulatory | UBPR → Executive Summary |
| Trend question | UBPR → Performance Trends (metric pre-selected, range set) |
| Peer comparison | UBPR → Peer Benchmarking |
| Balance sheet / schedule | Call Report → Sections |
| Key metrics | Call Report → Metrics |
| PDF filing | Call Report → PDF |

### Gemini usage

Gemini is only invoked when:
1. The question requires financial domain knowledge not available in our data (e.g. "Explain CET1")
2. The question is genuinely ambiguous between data sources

All questions about a specific bank's actual data are answered using our APIs directly through LangChain tools — Gemini is used only to format and interpret the tool output, not to generate financial numbers.

---

## Automated Ingestion

The ingestion pipeline runs daily at 12:00 UTC via GitHub Actions (`.github/workflows/ubpr_ingestion.yml`).

On most days it completes in under 60 seconds — a delta check compares R2 inventory against FFIEC availability and exits immediately if nothing is new. On the day FFIEC publishes a new quarter, it downloads the XBRL ZIP, parses all institution XMLs with PySpark, and writes the Parquet file to R2.

> To run the ingestion workflow on a fork, add the following secrets under Settings → Secrets → Actions: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `FFIEC_USER_ID`, `FFIEC_PWS_TOKEN`.

**Manual trigger options:**

| Mode | Description |
|---|---|
| `incremental` | Missing quarters from the last 2 years only (default) |
| `full` | Full backfill from 2001 onward |
| `dry-run` | Show what would be ingested — no downloads |
| `force` | Skip the delta check |

---

## Local Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- FFIEC CDR API credentials — register at https://cdr.ffiec.gov
- Cloudflare R2 credentials with access to the `ffiec-data` bucket
- Google Gemini API key — https://aistudio.google.com

### 1. Clone

```bash
git clone https://github.com/suyog12/ffiec-call-report-builder.git
cd ffiec-call-report-app
```

### 2. Configure environment

Copy the root template and fill in your values:

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```bash
# Mac / Linux
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# FFIEC API
FFIEC_BASE_URL=https://ffieccdr.azure-api.us/public
FFIEC_USER_ID=your_user_id
FFIEC_PWS_TOKEN=your_token

# Backend — use localhost for local dev
APP_HOST=127.0.0.1
APP_PORT=8000
BACKEND_URL=http://127.0.0.1:8000

# Cloudflare R2
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET=ffiec-data

# AI Agent
GEMINI_API_KEY=your_gemini_api_key

# BigData
UBPR_NUM_QUARTERS=8
```

Frontend uses its own `.env` file (Vite requires `VITE_` prefix). For local dev, create `frontend/.env.local`:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

`frontend/.env` already contains the production Render URL and is used automatically on Vercel.

### 3. Install dependencies

All Python dependencies are in a single root `requirements.txt`:

```powershell
pip install -r requirements.txt
pip install -e bigdata
```

### 4. Run

**Terminal 1 — Backend:**

```powershell
cd backend
$env:PYTHONPATH = "path\to\ffiec-call-report-app\bigdata;path\to\ffiec-call-report-app\backend"
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Watch for:
```
AI agent endpoint mounted at /agent/chat
INFO: Application startup complete.
```

**Terminal 2 — Frontend:**

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`

---

## API Reference

### Call Report

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/periods/` | Available reporting quarter-end dates |
| GET | `/banks/` | Panel of reporters for a period |
| GET | `/reports/pdf` | PDF facsimile |
| GET | `/reports/available-sections` | Section names in a filing |
| GET | `/reports/section-data` | Rows for selected sections |
| GET | `/reports/metrics` | Computed financial metrics |
| GET | `/reports/all-fields` | Full field catalog grouped by section |

### UBPR

| Method | Path | Description |
|---|---|---|
| GET | `/ubpr/quarters` | Available ingested quarters from R2 |
| GET | `/ubpr/ratios` | Priority ratios for one bank/quarter |
| GET | `/ubpr/trend` | Metric trend across a quarter range |
| GET | `/ubpr/peer-comparison` | Bank ratios vs peer group averages |
| GET | `/ubpr/all-fields` | All non-null fields for one bank/quarter |

### AI Agent

| Method | Path | Description |
|---|---|---|
| POST | `/agent/chat` | Send a question, receive answer + dashboard action |

**Request body:**
```json
{
  "question": "What is the CET1 ratio?",
  "rssd_id": "480228",
  "bank_name": "BANK OF AMERICA, NATIONAL ASSOCIATION",
  "quarter": "20251231",
  "period": "12/31/2025",
  "available_periods": [],
  "available_quarters": [],
  "thread_id": "session-123",
  "stream": false
}
```

Full interactive docs at https://ffiec-call-report-builder.onrender.com/docs

---

## Project Structure

```
ffiec-call-report-app/
├── .env.example                           # Single env template — copy to .env
├── requirements.txt                       # Single requirements — all services
├── pyrightconfig.json                     # Pylance path config
├── .github/workflows/ubpr_ingestion.yml   # Daily PySpark ingestion
│
├── backend/                               # FastAPI app (Render root directory)
│   └── app/
│       ├── main.py                        # App entry point, mounts ai_agent router
│       ├── routes/                        # health, periods, banks, reports, ubpr
│       ├── services/                      # report_service, ubpr_service
│       ├── clients/ffiec_client.py
│       └── utils/sdf_parser.py
│
├── bigdata/                               # Installable big data package
│   ├── ingestion/
│   │   ├── ubpr_ingest.py                 # PySpark pipeline: FFIEC → R2 Parquet
│   │   └── cleanup_unpublished_quarters.py
│   └── queryengine/query_engine.py        # DuckDB + R2 query functions
│
├── ai_agent/                              # LangChain/LangGraph AI agent
│   ├── agents/
│   │   └── orchestrator.py               # 3-way router: data / knowledge / out-of-scope
│   ├── server/
│   │   └── chat_endpoint.py              # FastAPI router — /agent/chat
│   ├── tools/
│   │   ├── ubpr_tools.py                 # LangChain tools → UBPRService (in-process)
│   │   ├── call_report_tools.py          # LangChain tools → ReportService (in-process)
│   │   └── period_resolver.py            # Natural language → FFIEC period format
│   └── memory/checkpointer.py            # LangGraph MemorySaver
│
├── frontend/                              # React + Vite app (Vercel)
│   ├── .env                              # Production env (VITE_API_BASE_URL → Render)
│   ├── .env.local                        # Local dev env (gitignored)
│   └── src/
│       ├── App.jsx                       # Root — layout, routing, chat wiring
│       ├── components/
│       │   ├── ChatPanel.jsx             # AI assistant panel
│       │   ├── Sidebar.jsx               # Fixed navigation sidebar
│       │   └── ubpr/
│       │       ├── PerformanceTrends.jsx # Trend charts (chatbot-controllable)
│       │       ├── ExecutiveSummary.jsx
│       │       ├── PeerBenchmarking.jsx
│       │       └── MultiCompare.jsx
│       ├── pages/
│       │   ├── UBPRDashboard.jsx         # UBPR page (exposes imperative ref API)
│       │   ├── Overview.jsx
│       │   ├── Sections.jsx
│       │   ├── Metrics.jsx
│       │   └── PDFPage.jsx
│       └── services/api.js               # All backend API calls
│
└── tests/                                 # Diagnostic scripts
```

---

## Deployment

### Render (Backend)

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Build Command | `pip install -r ../requirements.txt && pip install -e ../bigdata` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Python Version | 3.11 |

Environment variables to set in Render dashboard: `FFIEC_BASE_URL`, `FFIEC_USER_ID`, `FFIEC_PWS_TOKEN`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `GEMINI_API_KEY`, `BACKEND_URL`, `UBPR_NUM_QUARTERS`, `ALLOWED_ORIGIN`.

### Vercel (Frontend)

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

Environment variable to set in Vercel dashboard: `VITE_API_BASE_URL=https://ffiec-call-report-builder.onrender.com`

---

## Utility Scripts

```bash
# Verify R2 connectivity
python tests/test_r2_connection.py

# Inspect Parquet schema
python tests/test_all_columns.py

# Debug a specific bank and quarter
python tests/test_debug_parquet.py

# Remove unpublished quarters from R2 (dry run first)
python bigdata/ingestion/cleanup_unpublished_quarters.py --dry-run
python bigdata/ingestion/cleanup_unpublished_quarters.py
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Backend won't start | Check root `.env` exists with all required values and `PYTHONPATH` includes `bigdata` and `backend` |
| `AI agent not available` on startup | `PYTHONPATH` is missing `backend` — the agent can't find `app.services.*` |
| Financial Analysis shows no data | Verify R2 credentials — `R2_ACCESS_KEY_ID` is the short key, `R2_SECRET_ACCESS_KEY` is the long one |
| Call Report periods not loading | Verify `FFIEC_USER_ID` and `FFIEC_PWS_TOKEN` are correct |
| Chatbot times out for large banks locally | Expected — R2 latency from your machine is high. Test on Render where R2 is in the same region |
| GitHub Actions ingestion fails | Check all 6 secrets are set in Settings → Secrets → Actions |
| Quarter appears in UI with no data | Run `cleanup_unpublished_quarters.py --dry-run` to identify and remove it |
| Pylance shows missing import errors for `app.services.*` | Reload VS Code window — `pyrightconfig.json` already has `backend` in `extraPaths` |

---

## Notes

- Never commit real `.env` files — only `.env.example`
- `frontend/.env.local` is gitignored and used for local dev only
- `app.run/` is for local use only
- The Financial Analysis module requires R2 access; Call Reports only need FFIEC credentials
- The ingestion pipeline steps back 2 quarters from today to account for FFIEC's ~45–60 day publication lag
- The AI agent runs inside the same Render process as the backend — tools call services directly in-process, no HTTP overhead

---

*William & Mary MSBA — Team 9, Class of 2026*
