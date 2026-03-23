# FFIEC Call Report Dashboard

A full-stack web application for retrieving, exploring, and comparing FFIEC Call Report filings. It connects directly to the FFIEC public API, parses the raw SDF (Structured Data Format) responses, and presents the data through a multi-tab dashboard with a guided custom report builder that supports multi-bank and multi-period analysis.

---

## Background

U.S. banks and other depository institutions are required to file Call Reports with the Federal Financial Institutions Examination Council (FFIEC) on a quarterly basis. These filings contain detailed balance sheet, income, loan, and capital data across dozens of schedules such as RC (Balance Sheet), RI (Income Statement), and RC-C (Loans and Leases). The FFIEC makes this data available through a public web API, but consuming it directly requires handling base64-encoded SDF files, schedule normalization, and a fair amount of parsing work. This application wraps all of that into a clean interface.

---

## What the Application Does

- Loads the list of available reporting periods and panel of reporting institutions directly from the FFIEC API
- Lets users select one or more banks and one or more reporting periods from a sidebar
- Fetches and parses SDF filings for each bank and period combination
- Displays a summary overview, key financial metrics, raw schedule data, and the original PDF facsimile
- Provides a guided Custom Report Builder where users select schedules, pick individual fields, and generate a pivoted comparison table across banks and periods
- Exports custom reports as CSV or PDF via the browser's native print dialog

---

## Tech Stack

**Backend:** Python 3.11+, FastAPI, httpx, python-dotenv, pydantic, uvicorn

**Frontend:** React 18, Vite 5, plain CSS (no component library)

**Data source:** FFIEC CDR Public API (`https://ffieccdr.azure-api.us/public`)

---

## Project Structure

```
ffiec-call-report-app/
├── backend/
│   ├── .env                         # API credentials and server config
│   ├── requirements.txt
│   └── app/
│       ├── main.py                  # FastAPI app setup, CORS, router registration
│       ├── config.py                # Loads environment variables into a Settings object
│       ├── clients/
│       │   └── ffiec_client.py      # All HTTP calls to the FFIEC API
│       ├── routes/
│       │   ├── health.py            # GET /health -liveness check
│       │   ├── periods.py           # GET /periods/ -available reporting periods
│       │   ├── banks.py             # GET /banks/ -panel of reporters for a period
│       │   └── reports.py           # GET /reports/* -SDF, PDF, metrics, sections, fields
│       ├── services/
│       │   ├── period_service.py    # Thin wrapper around ffiec_client for periods
│       │   ├── bank_service.py      # Thin wrapper around ffiec_client for banks
│       │   └── report_service.py    # SDF fetch, parse, section grouping, metrics logic
│       └── utils/
│           └── sdf_parser.py        # SDF decode, CSV parse, schedule normalization
│
└── frontend/
    ├── .env                         # VITE_API_BASE_URL
    ├── index.html
    ├── vite.config.js
    ├── package.json
    └── src/
        ├── main.jsx                 # React root, mounts App
        ├── index.css                # Design system -layout, sidebar, buttons, tabs
        ├── App.jsx                  # Root component, global state, data fetching
        ├── services/
        │   └── api.js               # All fetch calls to the backend
        ├── components/
        │   ├── Sidebar.jsx          # Collapsible dark sidebar with multi-select dropdowns
        │   ├── Header.jsx           # Top bar with sidebar toggle, bank name, period badge
        │   ├── Tabs.jsx             # Tab navigation bar
        │   ├── MetricCard.jsx       # Single metric display card
        │   ├── SectionTable.jsx     # Generic table for schedule rows
        │   └── PDFViewer.jsx        # Iframe wrapper for the PDF facsimile
        └── pages/
            ├── Overview.jsx         # Summary metrics grid for a single report
            ├── PDFPage.jsx          # Renders PDFViewer with the fetched PDF URL
            ├── Sections.jsx         # Renders SectionTable for selected RC/RI sections
            ├── Metrics.jsx          # Formatted key metrics grouped by category
            └── CustomReport.jsx     # Four-step guided report builder
```

---

## Backend

### main.py

Sets up the FastAPI application, registers CORS middleware allowing requests from `localhost:5173` (the Vite dev server), and mounts the four route modules. Nothing application-specific lives here.

### config.py

Reads three environment variables using `python-dotenv`: `FFIEC_BASE_URL`, `FFIEC_USER_ID`, and `FFIEC_PWS_TOKEN`. These are consumed by `FFIECClient` on instantiation. A single `settings` object is imported wherever configuration is needed.

### clients/ffiec_client.py

The only file that makes outbound HTTP requests. All requests are async using `httpx.AsyncClient`. It implements four methods:

- `retrieve_reporting_periods` -calls `RetrieveReportingPeriods` with `dataSeries: Call` and returns the list of available quarter-end dates
- `retrieve_panel_of_reporters` -calls `RetrievePanelOfReporters` for a given period and returns the list of banks with their RSSD IDs, names, cities, and states
- `retrieve_call_report_pdf` -calls `RetrieveFacsimile` with `facsimileFormat: PDF`, decodes the base64-encoded JSON response, and returns raw PDF bytes
- `get_facsimile` -calls `RetrieveFacsimile` with `facsimileFormat: SDF` and returns the raw httpx response object for further processing

Note: the class has a duplicate `_headers` method definition (one instance method, one without `extra_headers`). The second definition shadows the first. This does not currently cause a bug but should be cleaned up.

### utils/sdf_parser.py

Handles the conversion from raw FFIEC SDF response to a list of structured row dictionaries.

`decode_sdf_response_text` handles the multi-layer encoding the FFIEC API uses: the response body is a JSON string whose value is a base64-encoded string whose content is the actual semicolon-delimited SDF text. This function unwraps those layers.

`parse_sdf_text` reads the semicolon-delimited SDF using Python's `csv.reader`, skips the header row, and maps each line to a dictionary with fields for `item_code` (the MDRM code), `value`, `description`, `section`, `line_number`, `call_date`, and `last_update`.

`normalize_schedule` standardizes the raw schedule name from the SDF into consistent labels used throughout the application. For example, any schedule starting with `RC` (except `RCC`) is normalized to `RC`, and `RCC` variants become `RC-C`.

`group_sections` takes the flat list of rows and returns a dictionary keyed by section name, where each value is the list of rows belonging to that section.

### services/report_service.py

The main business logic layer for reports.

`get_sdf_report` fetches the SDF facsimile via `ffiec_client.get_facsimile`, decodes and parses it through `sdf_parser`, groups the rows by section, and returns a unified dictionary containing the raw preview text, available section names, the grouped sections, and the flat `all_rows` list.

`get_selected_sections` calls `get_sdf_report` and filters the result to only the sections the caller requested.

`build_metrics` scans all rows for specific MDRM item codes and returns a dictionary of computed financial metrics. It builds a lookup map of item codes to row objects in a single O(n) pass, then does O(1) lookups for each metric. The function tries multiple code variants per metric to handle differences across bank types and filing formats. For example, total assets tries `RCFD2170`, `RCON2170`, `RCOA2170`, and `RCFD3368` in that order and uses the first non-null value. All missing values return `None` rather than zero to allow the frontend to distinguish between a reported zero and a field that was not found.

The metrics currently computed are: total assets, total loans, total deposits, total equity, net income, residential real estate subtotals (1-4 family, multifamily, construction), residential loan ratio, equity-to-assets ratio, and loans-to-deposits ratio.

### routes/reports.py

Exposes five endpoints under `/reports`:

- `GET /reports/pdf` -streams the PDF bytes back with `Content-Disposition: inline`
- `GET /reports/sdf` -returns the full parsed SDF as JSON including raw preview, sections, and all rows
- `GET /reports/available-sections` -returns just the list of section names present in a filing
- `GET /reports/section-data` -accepts a `sections` query parameter list and returns rows for those sections only
- `GET /reports/metrics` -returns computed financial metrics plus the total row count
- `GET /reports/all-fields` -returns all parsed rows grouped by section with internal fields stripped, used by the Custom Report Builder. Each field gets a stable `id` in the format `{section}::{item_code}`.

---

## Frontend

### App.jsx

The root component that owns all global state and orchestrates data fetching. On mount it loads the list of reporting periods from the backend and auto-selects the most recent one. When the primary selected period changes it reloads the bank list. When the user clicks Load Reports it fires parallel requests for every bank and period combination using `Promise.all`, storing results in a `reportsByKey` map keyed by `{rssdId}::{period}`. Each tab receives the data it needs from this map. The Custom Report tab receives the full `selectedBanks`, `selectedPeriods`, and `banksById` lookup and manages its own data fetching independently.

### services/api.js

A thin module of async fetch functions. Each function constructs the URL, calls fetch, checks `response.ok`, and returns `response.json()`. There is no caching or retry logic here. The base URL is hardcoded to `http://127.0.0.1:8000`. Functions: `fetchPeriods`, `fetchBanks`, `fetchSDF`, `fetchAvailableSections`, `fetchSectionData`, `fetchMetrics`, `fetchAllFields`, `getPdfUrl`.

### components/Sidebar.jsx

A dark-themed collapsible sidebar (`background: #0f172a`) that contains two multi-select dropdowns and a load button. The `MultiSelect` component is defined within this file and handles its own open/close state, keyboard-accessible search filtering, chip display for selected values, indeterminate checkbox states, and a footer with selected count and clear-all. The bank dropdown calls `onSearch("")` after each selection to clear the search input automatically. The sidebar collapses to `width: 0` with a CSS transition when toggled.

### components/Header.jsx

A sticky top bar that shows a hamburger/close toggle button, the selected bank name, and a period badge. Clicking the toggle fires `onToggleSidebar` in App.

### components/Tabs.jsx

Renders the five tab buttons (Overview, PDF, Sections, Metrics, Custom). The active tab gets a sky-blue bottom border. Tab icons are Unicode characters, no external icon library is used.

### pages/Overview.jsx

Displays the bank name, reporting period, and a grid of MetricCard components for the seven main metrics returned by the backend.

### pages/Metrics.jsx

A more detailed view of the same metrics data, grouped into four labeled sections: Balance Sheet, Income, Residential RE, and Ratios. Ratios are formatted as percentages.

### pages/Sections.jsx

Iterates over the sections returned by `fetchSectionData` (defaulting to RC and RI) and renders a `SectionTable` for each. When multiple bank and period combinations are loaded, each combination gets a labeled header showing the bank name and period before its section tables.

### pages/PDFPage.jsx

Wraps `PDFViewer` with a heading. When multiple reports are loaded, the PDFs stack vertically with a labeled header for each.

### components/PDFViewer.jsx

Renders an iframe pointing at `/reports/pdf`. The browser renders the PDF natively. Displays a plain text fallback when no URL is provided.

### pages/CustomReport.jsx

This is the most complex file in the frontend. It implements a four-step wizard:

**Step 1 -Sections.** The user picks which FFIEC schedules to include. Available sections are grouped into Balance Sheet (RC family), Income (RI family), and Other. Selecting sections does not trigger any API calls yet.

**Step 2 -Fields.** The catalog for all selected sections is fetched from `/reports/all-fields` for every bank and period combination in parallel. The first bank and period's catalog is used as the reference for field selection. The user can search by item code or description and select individual fields or all fields within a section using a select-all checkbox with indeterminate state.

**Step 3 -Banks.** For each bank, the application computes which of the selected fields are actually present in that bank's filing. Single-bank flows show a simple confirmation with a warning listing any missing fields. Multi-bank flows show each bank as a collapsible card with a present/missing badge. The user can expand any bank card to uncheck specific fields for that bank, which creates a per-bank override set.

**Step 4 -Preview.** Builds a pivoted table where rows are item codes and columns are bank and/or period combinations. Missing fields show as a dash. The table supports horizontal scrolling when there are many columns. The export functions (`handleCSV` and `handlePDF`) are defined here using the computed `pivoted` and `colKeys` values, then registered into a shared `exportRef` via `useEffect`. The sticky `StepBar` component at the top reads from this ref at click time (not during render) to avoid timing issues.

**Export mechanics:**

CSV export builds a 2D array of rows with section, item code, description, and one column per bank-period combination, then serializes it to a UTF-8 CSV blob and triggers a download via a temporary anchor element.

PDF export builds an HTML string with print-optimized CSS, injects it into a hidden iframe via `srcdoc`, and calls `contentWindow.print()` from the iframe's `onload` handler. The browser's native print-to-PDF dialog handles the rest. The iframe is removed from the DOM after two seconds.

---

## Setup and Running

### Prerequisites

- Python 3.11 or higher
- Node.js 18 or higher
- An FFIEC CDR API account (register at https://cdr.ffiec.gov)

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create or edit `backend/.env`:

```
FFIEC_BASE_URL=https://ffieccdr.azure-api.us/public
FFIEC_USER_ID=your_user_id
FFIEC_PWS_TOKEN=your_token
APP_HOST=127.0.0.1
APP_PORT=8000
```

Start the server:

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The API will be available at `http://127.0.0.1:8000`. Interactive documentation is at `http://127.0.0.1:8000/docs`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Returns `{"status": "ok"}` |
| GET | /periods/ | List of available reporting quarter-end dates |
| GET | /banks/?reporting_period= | Panel of reporters for a given period |
| GET | /reports/pdf?rssd_id=&reporting_period= | PDF facsimile bytes |
| GET | /reports/sdf?rssd_id=&reporting_period= | Full parsed SDF as JSON |
| GET | /reports/available-sections?rssd_id=&reporting_period= | Section names present in the filing |
| GET | /reports/section-data?rssd_id=&reporting_period=&sections= | Rows for selected sections |
| GET | /reports/metrics?rssd_id=&reporting_period= | Computed financial metrics |
| GET | /reports/all-fields?rssd_id=&reporting_period= | Full field catalog grouped by section |

All report endpoints accept `rssd_id` as an integer and `reporting_period` as a date string in `MM/DD/YYYY` format, for example `12/31/2025`.

---

## Known Limitations

The `_headers` method in `ffiec_client.py` is defined twice. The second definition (without `extra_headers`) shadows the first. The `retrieve_reporting_periods` and `retrieve_panel_of_reporters` methods construct their own headers dictionaries inline to work around this, but the duplicate definition should be removed.

There is no server-side caching. Every call to a report endpoint re-fetches and re-parses the SDF from the FFIEC API. For multi-bank multi-period scenarios this means several sequential FFIEC requests. Adding a simple in-memory or Redis cache keyed by `rssd_id + reporting_period` would significantly improve load times.

The `normalize_schedule` function in `sdf_parser.py` only handles a subset of schedule names explicitly. Any schedule that does not match the RC or RI patterns is returned as-is after uppercasing. This means some less common schedules may appear under inconsistent names depending on how the FFIEC formats them in a given filing.

The frontend API base URL is hardcoded in `api.js` as `http://127.0.0.1:8000` rather than reading from the `VITE_API_BASE_URL` environment variable defined in `frontend/.env`. To use the environment variable, change the first line of `api.js` to `const BASE_URL = import.meta.env.VITE_API_BASE_URL`.

---

## Environment Variables

### Backend (.env)

| Variable | Description |
|----------|-------------|
| FFIEC_BASE_URL | Base URL for the FFIEC CDR API |
| FFIEC_USER_ID | Your FFIEC CDR username |
| FFIEC_PWS_TOKEN | Your FFIEC CDR bearer token |
| APP_HOST | Host to bind uvicorn to (default 127.0.0.1) |
| APP_PORT | Port to bind uvicorn to (default 8000) |

### Frontend (.env)

| Variable | Description |
|----------|-------------|
| VITE_API_BASE_URL | Backend base URL (currently unused in api.js, see Known Limitations) |
