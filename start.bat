@echo off
echo Starting OutbreakResponseOS...

REM Start Backend
start "OutbreakResponseOS Backend" cmd /c "cd backend && uvicorn main:app --reload --host 127.0.0.1 --port 8000"

REM Start Frontend
start "OutbreakResponseOS Frontend" cmd /c "cd outbreak-dashboard && npm run dev"

echo Both services started.
echo Backend: http://127.0.0.1:8000
echo Frontend: http://localhost:5173
