#!/usr/bin/env bash

# ==============================================================================
# Blockchain Identity Verification System - Linux / Cloud VPS Launcher
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

echo "=========================================================="
echo "🇮🇳  Starting Indian National Identity Verification Platform"
echo "=========================================================="

# 1. Check or set up Python virtual environment
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
    ./venv/bin/pip install --upgrade pip
    ./venv/bin/pip install -r python-service/requirements.txt
fi

# 2. Check Node dependencies
if [ ! -d "backend/node_modules" ]; then
    echo "Installing Node.js dependencies..."
    (cd backend && npm install)
fi

# 3. Start Python Blockchain Service in background
echo "Starting Python Blockchain Service on port 5001..."
./venv/bin/python python-service/app.py &
PYTHON_PID=$!

sleep 2

# 4. Start Node.js Express Backend
echo "Starting Node.js Backend Server on port 3000..."
(cd backend && node server.js) &
NODE_PID=$!

echo ""
echo "✅ Both services started successfully!"
echo "👉 Web Portal URL: http://localhost:3000"
echo "👉 Python Blockchain Service: http://localhost:5001"
echo ""
echo "Press CTRL+C to stop all services."

# Trap SIGINT / SIGTERM to clean up background processes
trap "echo 'Stopping services...'; kill $PYTHON_PID $NODE_PID 2>/dev/null; exit 0" SIGINT SIGTERM

wait
