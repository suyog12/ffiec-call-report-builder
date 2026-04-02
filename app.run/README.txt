# FFIEC Call Report App

A local web application for exploring FFIEC call report data with a FastAPI backend and Vite/React frontend.

## Prerequisites

Install these before running the project:

- Python 3.10 or higher
- Node.js 18 or higher
- Git

## How to install prerequisites

### 1. Install Git

Download and install Git from the official website.  
After installing, verify it works:

```bash
git --version
```

### 2. Install Python

Download and install Python 3.10+ from the official Python website.

> **Important during installation on Windows:** check "Add Python to PATH"

After installing, verify:

```bash
python --version
```

If that does not work, try:

```bash
py --version
```

### 3. Install Node.js

Download and install Node.js 18+ from the official Node.js website.  
After installing, verify:

```bash
node --version
npm --version
```

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/suyog12/ffiec-call-report-builder.git
cd ffiec-call-report-app
```

### 2. Create environment files

Copy the example environment files:

- copy `backend/.env.example` to `backend/.env`
- copy `frontend/.env.example` to `frontend/.env`

**On Windows Command Prompt:**

```cmd
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
```

**On PowerShell:**

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

### 3. Fill in backend environment values

Open `backend/.env` and add the required backend configuration values.

### 4. Check frontend environment file

Make sure `frontend/.env` contains:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

---

## Run locally

Open:

```
app.run/START_APP.bat
```

or double-click `START_APP.bat` inside the `app.run` folder.

This will:

- create a Python virtual environment if needed
- install backend dependencies if needed
- install the bigdata package (DuckDB + R2 query engine) if needed
- install frontend dependencies if needed
- start backend and frontend
- open the app in your browser

### Manual run option

If you prefer to start the app manually:

**Backend:**

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install -e ../bigdata
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Frontend** (in a separate terminal):

```bash
cd frontend
npm install
npm run dev
```

Then open:

```
http://localhost:5173
```

---

## Troubleshooting

**Python is not recognized**  
Reinstall Python and make sure "Add Python to PATH" is enabled.

**`py` works but `python` does not**  
Use `py` instead of `python` on Windows.

**`npm` is not recognized**  
Reinstall Node.js and confirm it was added to PATH.

**Browser does not open automatically**  
Open this URL manually:

```
http://localhost:5173
```

**Backend does not start**  
Check that `backend/.env` exists and contains the required values.

**Financial Analysis tab shows no data**  
Make sure `backend/.env` contains valid Cloudflare R2 credentials:
```
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<your_key>
R2_SECRET_ACCESS_KEY=<your_secret>
R2_BUCKET=ffiec-data
```

---

## Notes

- Do not commit real `.env` files to Git
- Commit only `.env.example` files
- The `app.run` folder is meant for local convenience, not cloud hosting
- The Financial Analysis module requires Cloudflare R2 access for UBPR trend data