@echo off
cd /d "%~dp0..\frontend"

if not exist node_modules (
    echo Installing frontend dependencies...
    npm install
)

echo Starting Vite frontend...
start "FFIEC Frontend" cmd /k "npm run dev"