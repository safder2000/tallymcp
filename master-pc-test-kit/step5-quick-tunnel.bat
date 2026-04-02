@echo off
title Step 5 — Quick Cloudflare Tunnel (temporary)
echo.
echo ========================================================================
echo  STEP 5: Temporary Cloudflare Tunnel to MCP Server (port 3000)
echo ========================================================================
echo.
echo  BEFORE running this:
echo    • step4-start-mcp-server.bat must be running in another window
echo    • Tally Prime must be running
echo.
echo  This creates a TEMPORARY public URL (changes each time).
echo  For permanent setup, use Zero Trust dashboard with a named tunnel.
echo.
echo ========================================================================
echo.

where cloudflared >nul 2>&1
if errorlevel 1 (
    echo cloudflared not found in PATH.
    echo.
    echo Download from:
    echo   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    echo.
    echo After installing, reopen this window and try again.
    echo Or run manually:
    echo   cloudflared tunnel --url http://localhost:3000
    echo.
    pause
    exit /b 1
)

echo Running: cloudflared tunnel --url http://localhost:3000
echo.
echo Look for a line like:
echo   https://something-random.trycloudflare.com
echo.
echo Test that URL from your PHONE or another computer.
echo Share it with whoever is setting up the VPS.
echo.
echo Press Ctrl+C to stop the tunnel.
echo.

cloudflared tunnel --url http://localhost:3000

echo.
echo Tunnel stopped.
pause
