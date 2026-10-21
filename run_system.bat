@echo off
echo ===================================================
echo Starting Government Digital Certificate System...
echo ===================================================

cd /d "%~dp0"

echo [1/2] Starting Python Blockchain Service on port 5001...
start "Python Blockchain Node" cmd /k ".\venv\Scripts\python.exe .\python-service\app.py"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Node.js Express Backend on port 3000...
start "Node.js Web Backend" cmd /k "cd backend && node server.js"

timeout /t 2 /nobreak >nul

echo ===================================================
echo Applications launched successfully!
echo Opening Web Portal in your browser...
echo URL: http://localhost:3000
echo ===================================================

start http://localhost:3000
