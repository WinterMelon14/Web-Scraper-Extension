@echo off
echo Starting Context Capture API Server (Python/FastAPI)...
echo.

set API_PATH=%~dp0api-server

cd /d "%API_PATH%"

REM Check if virtual environment exists
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Install dependencies
pip install -r requirements.txt --quiet

echo.
echo Starting server on http://127.0.0.1:3000
echo Press Ctrl+C to stop
echo.

python server.py
pause