@echo off
echo Starting FFIEC Call Report App...

call "%~dp0start_backend.bat"
timeout /t 5 /nobreak >nul
call "%~dp0start_frontend.bat"
timeout /t 5 /nobreak >nul

start http://localhost:5173
exit