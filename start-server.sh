#!/bin/bash

echo "Starting Context Capture API Server (Python/FastAPI)..."
echo ""

API_PATH="$(cd "$(dirname "$0")/api-server" && pwd)"
cd "$API_PATH"

# Create virtual environment if needed
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt --quiet

echo ""
echo "Starting server on http://127.0.0.1:3000"
echo "Press Ctrl+C to stop"
echo ""

python server.py