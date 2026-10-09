@echo off
REM SAARTHI keepalive boot -- bulletproof local boot for backend :8003 + frontend :5173.
REM (Matches vite proxy in frontend-react/vite.config.js; changes NO app behavior.)
REM
REM What it does:
REM   [1] Kills stale LISTENING processes on 8003/5173 (dead shells, Ctrl+C leftovers).
REM   [2] Starts backend  (python -m uvicorn backend.main:app --host 127.0.0.1 --port 8003)
REM       in its own MINIMIZED window, logging to %TEMP%\opencode\saarthi-backend.log.
REM   [3] Starts frontend (npm run dev in frontend-react, --host 127.0.0.1 --port 5173
REM       --strictPort) in its own MINIMIZED window, logging to
REM       %TEMP%\opencode\saarthi-frontend.log.
REM   [4] Waits for readiness (up to ~60s per server), then curl-verifies
REM       http://127.0.0.1:8003/api/health and http://127.0.0.1:5173/ (200).
REM       Prints PASS/FAIL per server.
REM
REM Run:  tools\keepalive.bat   (from repo root; double-click also works)
REM start-saarthi.bat is left untouched.
REM NOTE: closing a server window still stops that server (Windows cannot keep a
REM console app alive without its console). Minimized + separate windows + logs make
REM accidental Ctrl+C / close far less likely; re-run this script to recover.

setlocal EnableDelayedExpansion
cd /d "%~dp0.." || exit /b 1

set "LOGDIR=%TEMP%\opencode"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >NUL 2>&1
set "BLOG=%LOGDIR%\saarthi-backend.log"
set "FLOG=%LOGDIR%\saarthi-frontend.log"

echo [1/4] Clearing stale listeners on ports 8003 and 5173 ...
for %%P in (8003 5173) do (
  for /f "tokens=5" %%Q in ('netstat -ano ^| findstr /R /C:":%%P[^0-9].*LISTENING" 2^>NUL') do (
    echo   port %%P: killing stale PID %%Q
    taskkill /F /PID %%Q >NUL 2>&1
  )
)
timeout /t 2 /nobreak >NUL 2>&1
if errorlevel 1 ping -n 3 127.0.0.1 >NUL

echo [2/4] Starting backend in minimized window ^(log: "%BLOG%"^) ...
start "SAARTHI backend" /min cmd /c python -m uvicorn backend.main:app --host 127.0.0.1 --port 8003 ^> "%BLOG%" 2^>^&1

echo [3/4] Starting frontend in minimized window ^(log: "%FLOG%"^) ...
start "SAARTHI frontend" /min /d "%CD%\frontend-react" cmd /c npm run dev -- --host 127.0.0.1 --port 5173 --strictPort ^> "%FLOG%" 2^>^&1

echo [4/4] Waiting for servers, then verifying ^(up to ~60s each^) ...
set "BCODE=000"
for /L %%i in (1,1,30) do (
  for /f "delims=" %%C in ('curl -s -o NUL -w "%%{http_code}" http://127.0.0.1:8003/api/health 2^>NUL') do set "BCODE=%%C"
  if "!BCODE!"=="200" goto backend_up
  timeout /t 2 /nobreak >NUL 2>&1
if errorlevel 1 ping -n 3 127.0.0.1 >NUL
)
:backend_up

set "FCODE=000"
for /L %%i in (1,1,30) do (
  for /f "delims=" %%C in ('curl -s -o NUL -w "%%{http_code}" http://127.0.0.1:5173/ 2^>NUL') do set "FCODE=%%C"
  if "!FCODE!"=="200" goto frontend_up
  timeout /t 2 /nobreak >NUL 2>&1
if errorlevel 1 ping -n 3 127.0.0.1 >NUL
)
:frontend_up

echo.
if "!BCODE!"=="200" (
  echo   backend  http://127.0.0.1:8003/api/health ... PASS ^(HTTP 200^)
  set "BRES=PASS"
) else (
  echo   backend  http://127.0.0.1:8003/api/health ... FAIL ^(HTTP !BCODE!^)
  set "BRES=FAIL"
)
if "!FCODE!"=="200" (
  echo   frontend http://127.0.0.1:5173/ .............. PASS ^(HTTP 200^)
  set "FRES=PASS"
) else (
  echo   frontend http://127.0.0.1:5173/ .............. FAIL ^(HTTP !FCODE!^)
  set "FRES=FAIL"
)
echo.
echo   logs: "%BLOG%" and "%FLOG%"
echo.

if "!BRES!"=="PASS" if "!FRES!"=="PASS" (
  echo ALL PASS -- open http://127.0.0.1:5173/
  exit /b 0
)
echo RECOVERY: check the logs above, then re-run tools\keepalive.bat
exit /b 1
