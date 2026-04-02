@echo off
title Step 3 — Test Tally + MCP Locally
cd /d "%~dp0"
echo.
echo ========================================================================
echo  STEP 3: Local connectivity tests
echo ========================================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Test-Local.ps1"
