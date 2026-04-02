@echo off
title Step 4 — Tally MCP Server (port 3000)
cd /d "%~dp0tally-mcp"
echo.
echo ========================================================================
echo  STEP 4: Starting Tally MCP HTTP Server on port 3000
echo ========================================================================
echo.
echo  This window must stay OPEN while the server runs.
echo  Press Ctrl+C to stop.
echo.
echo  The MCP server connects to Tally on localhost:9000 internally.
echo  External clients (VPS, Claude, etc.) connect to this server on port 3000
echo  via the Cloudflare tunnel.
echo.
echo ========================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Run step1 first.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo ERROR: node_modules not found. Run step2 first.
    pause
    exit /b 1
)

echo Starting: node dist/server.mjs
echo.

node dist/server.mjs

echo.
echo Server stopped.
pause
