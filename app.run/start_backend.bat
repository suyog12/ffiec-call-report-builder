@echo off
cd /d "%~dp0..\backend"

if not exist .venv (
    echo Creating Python virtual environment...
    py -m venv .venv
)

call .venv\Scripts\activate

echo Installing backend dependencies...
pip install -r requirements.txt

echo Starting FastAPI backend...
start "FFIEC Backend" cmd /k "call .venv\Scripts\activate && uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"