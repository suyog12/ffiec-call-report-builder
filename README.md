# FFIEC Call Report Analysis Dashboard

A full-stack financial analytics platform for exploring FFIEC Call Report filings and UBPR bank performance data. Built by William & Mary MSBA Team 9, Class of 2026.

**Live demo:** https://ffiec-call-report-builder.vercel.app/

---

## What it does

**Call Reports** — Search any FFIEC-reporting institution, load quarterly SDF filings, explore schedule data, view PDF facsimiles, and export custom pivot reports as CSV or PDF.

**Financial Analysis (UBPR)** — View 10 priority ratios with regulatory threshold alerts, chart 8-quarter performance trends, benchmark against size-based peer groups, compare up to 4 institutions side-by-side, and build custom ratio formulas from the full UBPR field set.

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
| AI | LangChain, LangGraph, Google Gemini |

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

DuckDB reads only the requested columns and the matching `rssd_id` row — no full table scans. An in-process LRU cache (1-hour TTL, 256 entries) keeps repeated requests under 200ms without hitting R2 again.

PySpark runs on GitHub Actions Linux runners — this sidesteps the Windows WinUtils/`HADOOP_HOME` dependency that makes local PySpark setup impractical on Windows. The workflow installs the Hadoop S3A JARs automatically and writes Parquet directly to R2 via the S3A connector.

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

### 1. Clone

```bash
git clone https://github.com/suyog12/ffiec-call-report-builder.git
cd ffiec-call-report-app
```

### 2. Configure environment

```bash
# Windows CMD
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env

# PowerShell / Mac / Linux
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

**`backend/.env`:**
```env
FFIEC_BASE_URL=https://ffieccdr.azure-api.us/public
FFIEC_USER_ID=your_user_id
FFIEC_PWS_TOKEN=your_token
APP_HOST=127.0.0.1
APP_PORT=8000

R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your_key
R2_SECRET_ACCESS_KEY=your_secret
R2_BUCKET=ffiec-data
```

**`frontend/.env`:**
```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

### 3. Run

**One click (Windows):** double-click `app.run/START_APP.bat`

**Manual:**
```bash
# Backend
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
pip install -e ../bigdata
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Frontend (separate terminal)
cd frontend
npm install && npm run dev
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

Full interactive docs at https://ffiec-call-report-builder.onrender.com/docs

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

## Project Structure

```
ffiec-call-report-app/
├── .github/workflows/ubpr_ingestion.yml   # Daily PySpark ingestion
├── backend/                               # FastAPI app
│   └── app/
│       ├── routes/                        # health, periods, banks, reports, ubpr
│       ├── services/                      # report_service, ubpr_service
│       ├── clients/ffiec_client.py
│       └── utils/sdf_parser.py
├── bigdata/                               # Installable big data package
│   ├── ingestion/
│   │   ├── ubpr_ingest.py                 # PySpark pipeline: FFIEC → R2 Parquet
│   │   └── cleanup_unpublished_quarters.py
│   ├── queryengine/query_engine.py        # DuckDB + R2 query functions
│   └── notebooks/                         # Jupyter documentation
│       ├── 01_ubpr_ingestion_pipeline.ipynb
│       ├── 02_duckdb_query_engine.ipynb
│       └── 03_fastapi_ubpr_routes.ipynb
├── frontend/                              # React + Vite app
│   └── src/
│       ├── components/ubpr/               # UBPR dashboard components
│       └── pages/                         # Call Report + UBPR pages
├── tests/                                 # Diagnostic scripts
└── app.run/                               # Windows one-click launchers
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Backend won't start | Check `backend/.env` exists with all required values |
| Financial Analysis shows no data | Verify R2 credentials in `backend/.env` |
| Call Report periods not loading | Verify `FFIEC_USER_ID` and `FFIEC_PWS_TOKEN` |
| GitHub Actions ingestion fails | Check all 6 secrets are set in Settings → Secrets → Actions |
| Quarter appears in UI with no data | Run `cleanup_unpublished_quarters.py --dry-run` to identify and remove it |

---

## Notes

- Never commit real `.env` files — only `.env.example`
- `app.run/` is for local use only
- The Financial Analysis module requires R2 access; Call Reports only need FFIEC credentials
- The ingestion pipeline steps back 2 quarters from today to account for FFIEC's ~45-60 day publication lag

---

*William & Mary MSBA — Team 9, Class of 2026*
