@echo off
title Step 2 — Install MCP Server Dependencies
cd /d "%~dp0tally-mcp"
echo.
echo ========================================================================
echo  STEP 2: npm install (in tally-mcp folder)
echo ========================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Run step1-install-node.bat first.
    echo.
    pause
    exit /b 1
)

echo Running: npm install --omit=dev
echo This may take a minute...
echo.

call npm install --omit=dev

if errorlevel 1 (
    echo.
    echo ERROR: npm install failed. Check errors above.
) else (
    echo.
    echo SUCCESS: Dependencies installed.
)

echo.
pause
