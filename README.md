# FFIEC Call Report Analysis Dashboard

A full-stack web application for retrieving, exploring, and comparing FFIEC Call Report filings and UBPR financial performance data. Built by William & Mary MSBA Team 9, Class of 2026.

---

## Background

U.S. banks file Call Reports with the FFIEC every quarter, containing detailed balance sheet, income, loan, and capital data. The FFIEC also publishes Uniform Bank Performance Reports (UBPR) - pre-calculated ratios covering capital adequacy, profitability, liquidity, and asset quality for every reporting institution back to 2001.

This application wraps both data sources into a unified dashboard built for financial analysts and bank examiners.

---

## What the Application Does

**Call Reports** - Select banks and periods from a sidebar, load SDF filings from the FFIEC API, explore schedule data, view the original PDF facsimile, and build custom pivot reports exported as CSV or PDF.

**Financial Analysis (UBPR)** - Search any FFIEC-reporting institution, view 10 priority ratios with regulatory threshold alerts, chart 8-quarter trends per metric, compare against size-based peer groups, run side-by-side multi-bank comparisons, and build custom ratio formulas.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+, FastAPI, httpx, uvicorn |
| Big Data | PySpark (ingestion), DuckDB httpfs (query), Cloudflare R2 (storage) |
| Frontend | React 18, Vite 5 |
| Call Report data | FFIEC CDR Public API |
| UBPR data | Parquet files in Cloudflare R2, queried via DuckDB |

---

## Project Structure

```
ffiec-call-report-app/
│
├── app.run/                          # One-click Windows launchers
│   ├── START_APP.bat                 # Launches backend + frontend + browser
│   ├── START_backend.bat             # Backend only
│   └── START_frontend.bat            # Frontend only
│
├── backend/                          # FastAPI application
│   ├── .env                          # Credentials (not committed)
│   ├── .env.example                  # Template for .env
│   ├── requirements.txt
│   └── app/
│       ├── main.py                   # App setup, CORS, router registration
│       ├── config.py                 # Loads env vars into Settings object
│       ├── clients/
│       │   └── ffiec_client.py       # All HTTP calls to the FFIEC API
│       ├── routes/
│       │   ├── health.py             # GET /health
│       │   ├── periods.py            # GET /periods/
│       │   ├── banks.py              # GET /banks/
│       │   ├── reports.py            # GET /reports/* (Call Report)
│       │   └── ubpr.py               # GET /ubpr/* (Financial Analysis)
│       ├── services/
│       │   ├── report_service.py     # SDF fetch, parse, metrics logic
│       │   └── ubpr_service.py       # UBPR ratio fetching, trend, peer avg
│       └── utils/
│           └── sdf_parser.py         # SDF decode, CSV parse, normalization
│
├── bigdata/                          # Installable big data package
│   ├── setup.py                      # pip install -e ./bigdata
│   ├── requirements.txt
│   ├── .env                          # R2 credentials for ingestion scripts
│   ├── ingestion/
│   │   └── ubpr_ingest.py            # PySpark pipeline: FFIEC → R2 Parquet
│   ├── queryengine/
│   │   └── query_engine.py           # DuckDB + R2 query functions, LRU cache
│   ├── notebooks/                    # Jupyter exploration notebooks
│   └── tests/                        # Bigdata package unit tests
│       └── __init__.py
│
├── tests/                            # Project-level diagnostic scripts
│   ├── test_r2_connection.py         # Verify R2 bucket connectivity
│   ├── test_all_columns.py           # Print full Parquet schema
│   ├── test_check_columns.py         # Check specific UBPR codes exist
│   ├── test_debug_parquet.py         # Inspect all fields for a bank/quarter
│   ├── test_find_capital_code.py     # Find capital ratio columns
│   ├── test_find_columns.py          # General keyword column search
│   ├── test_find_npl.py              # Find NPL-related columns
│   └── test_verify_codes.py          # Verify frontend UBPR_LOOKUP codes exist
│
├── frontend/                         # React + Vite application
│   ├── .env                          # VITE_API_BASE_URL
│   ├── .env.example
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx                   # Root component, global state
│       ├── main.jsx                  # React entry point
│       ├── index.css                 # Design system, layout, animations
│       ├── services/
│       │   └── api.js                # All fetch calls to the backend
│       ├── theme/
│       │   └── colors.js             # W&M color system (green, gold)
│       ├── constants/
│       │   └── ubprRatios.js         # UBPR code → label/category lookup
│       ├── utils/
│       │   └── ubprFormatters.js     # Number formatting, CSV export, watchlist
│       ├── components/
│       │   ├── Header.jsx            # Top bar with sidebar toggle
│       │   ├── Sidebar.jsx           # Collapsible dark sidebar
│       │   ├── Tabs.jsx              # Tab navigation
│       │   ├── MetricCard.jsx        # Single metric display card
│       │   ├── SectionTable.jsx      # Generic schedule data table
│       │   ├── PDFViewer.jsx         # PDF iframe wrapper
│       │   └── ubpr/
│       │       ├── BankSearch.jsx    # Autocomplete bank selector
│       │       ├── ExecutiveSummary.jsx   # 10 priority ratios + peer table
│       │       ├── DrillDownModal.jsx     # 8-quarter trend modal
│       │       ├── LineChart.jsx          # SVG line chart, scrollable
│       │       ├── RatioCard.jsx          # Individual ratio card
│       │       ├── PerformanceTrends.jsx  # Per-metric trend charts
│       │       ├── PeerBenchmarking.jsx   # Peer group comparison table
│       │       ├── MultiCompare.jsx       # Side-by-side bank comparison
│       │       └── BuildRatio.jsx         # Custom ratio formula builder
│       └── pages/
│           ├── Overview.jsx          # Call Report summary metrics
│           ├── PDFPage.jsx           # PDF facsimile viewer
│           ├── Sections.jsx          # Schedule data tables
│           ├── Metrics.jsx           # Grouped financial metrics
│           ├── CustomReport.jsx      # 4-step guided report builder
│           └── UBPRDashboard.jsx     # Financial Analysis tab shell
│
├── README.md
└── pyrightconfig.json
```

---

## Test Scripts

All diagnostic scripts live in `tests/` and are run from the project root. They require the bigdata package to be installed (`pip install -e ./bigdata`).

| Script | Purpose |
|--------|---------|
| `test_r2_connection.py` | Verifies Cloudflare R2 is reachable and the `ffiec-data` bucket exists. Run this first after configuring credentials. |
| `test_all_columns.py` | Prints every column name in the latest quarter's Parquet file. Use this to explore what UBPR codes are available. |
| `test_check_columns.py` | Checks whether a specific list of UBPR codes are present in the schema. Edit `CODES_TO_CHECK` to test any codes. |
| `test_debug_parquet.py` | Fetches all non-null fields for a specific bank and quarter. Edit `RSSD_ID` and `QUARTER` to inspect any bank. |
| `test_find_capital_code.py` | Searches the schema for capital ratio related columns and prints their values. Useful when a capital ratio is missing or wrong. |
| `test_find_columns.py` | General keyword search across all column names. Edit `KEYWORD` to search for any financial concept. |
| `test_find_npl.py` | Searches for Non-Performing Loan columns. Useful for identifying the correct NPL code across different bank filing types. |
| `test_verify_codes.py` | Verifies that all UBPR codes defined in `frontend/src/constants/ubprRatios.js` exist in the Parquet schema. Run after ingestion to catch any code mismatches. |

**Run any test:**
```bash
# From project root with bigdata installed
python tests/test_r2_connection.py
python tests/test_check_columns.py
python tests/test_debug_parquet.py
# etc.
```

---

## Prerequisites

- Python 3.10 or higher
- Node.js 18 or higher
- Git
- FFIEC CDR API credentials (register at https://cdr.ffiec.gov)
- Cloudflare R2 credentials with access to `ffiec-data` bucket

---

## Setup

### 1. Clone

```bash
git clone https://github.com/suyog12/ffiec-call-report-builder.git
cd ffiec-call-report-app
```

### 2. Environment files

**Windows CMD:**
```cmd
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
```

**PowerShell:**
```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

### 3. Backend `.env`

```env
# FFIEC Call Report API
FFIEC_BASE_URL=https://ffieccdr.azure-api.us/public
FFIEC_USER_ID=your_user_id
FFIEC_PWS_TOKEN=your_token
APP_HOST=127.0.0.1
APP_PORT=8000

# Cloudflare R2 - Financial Analysis module
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_key
R2_SECRET_ACCESS_KEY=your_secret
R2_BUCKET=ffiec-data
```

### 4. Frontend `.env`

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

---

## Run Locally

**One click:** double-click `app.run/START_APP.bat`

**Manual:**

```bash
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install -e ../bigdata
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`

---

## API Reference

### Call Report

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check |
| GET | `/periods/` | Available reporting quarter-end dates |
| GET | `/banks/` | Panel of reporters for a period |
| GET | `/reports/pdf` | PDF facsimile |
| GET | `/reports/available-sections` | Section names in a filing |
| GET | `/reports/section-data` | Rows for selected sections |
| GET | `/reports/metrics` | Computed financial metrics |
| GET | `/reports/all-fields` | Full field catalog grouped by section |

### Financial Analysis (UBPR)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ubpr/quarters` | Available ingested quarters from R2 |
| GET | `/ubpr/ratios` | All non-null UBPR fields for one bank/quarter |
| GET | `/ubpr/trend` | Trend for selected metric codes across a date range |
| GET | `/ubpr/peer-comparison` | Bank ratios vs peer group averages |
| GET | `/ubpr/all-fields` | Raw fields for one bank/quarter |

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
ubpr_ingest.py (PySpark)
      ↓
Cloudflare R2  (Parquet, partitioned by year/quarter)
      ↓
query_engine.py (DuckDB httpfs, LRU cache)
      ↓
ubpr_service.py → /ubpr/* → frontend
```

R2 key pattern: `ubpr/year={YYYY}/quarter={YYYYMMDD}/data.parquet`

DuckDB reads only the requested columns and the matching `rssd_id` row - no full table scans. An in-process LRU cache (1-hour TTL, 256 entries) prevents redundant R2 reads within a session.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Python not recognized | Reinstall Python, check "Add Python to PATH" |
| `npm` not recognized | Reinstall Node.js |
| Browser doesn't open | Navigate to `http://localhost:5173` manually |
| Backend won't start | Check `backend/.env` exists with valid values |
| Financial Analysis shows no data | Verify R2 credentials in `backend/.env` |
| Call Report periods not loading | Verify `FFIEC_USER_ID` and `FFIEC_PWS_TOKEN` |
| Custom Report shows "No filing data" | Selected period not yet filed with FFIEC |

---

## Notes

- Never commit real `.env` files - commit only `.env.example`
- `app.run/` is for local use only, not cloud deployment
- The Financial Analysis module requires R2 access; Call Reports work with FFIEC credentials only
- UBPR ingestion is run manually after each FFIEC quarterly data release using `bigdata/ingestion/ubpr_ingest.py`