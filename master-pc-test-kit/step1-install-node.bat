@echo off
title Step 1 — Install Node.js
echo.
echo ========================================================================
echo  STEP 1: Install Node.js
echo ========================================================================
echo.

where node >nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%i in ('node -v 2^>nul') do echo Node.js already installed: %%i
    echo.
    echo If this is v18 or higher, you can skip this step.
    echo.
    pause
    exit /b 0
)

echo Node.js is NOT installed. Opening download page...
echo Download the LTS version and install with default settings.
echo After install, CLOSE this window and reopen before running step2.
echo.
start https://nodejs.org/en/download
pause
