@echo off
REM SAARTHI local boot: backend :8003 + frontend :5173 (matches vite proxy).
REM Double-click this file. Keep both windows open while testing.
REM Backend .env lives in .env at repo root (gitignored). DEMO_MODE=false = live.
cd /d "%~dp0"
echo Starting backend on http://127.0.0.1:8003 ...
start "SAARTHI backend" cmd /k "python -m uvicorn backend.main:app --host 127.0.0.1 --port 8003"
cd /d "%~dp0frontend-react"
echo Starting frontend on http://127.0.0.1:5173 ...
start "SAARTHI frontend" cmd /k "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
echo Both servers launching in their own windows. Open http://127.0.0.1:5173/
pause
