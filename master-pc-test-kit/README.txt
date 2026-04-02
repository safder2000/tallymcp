================================================================================
  EMILDA — Master PC Setup Kit
  Tally MCP Server + Cloudflare Tunnel
================================================================================

WHAT THIS PACKAGE DOES
  Sets up the Tally MCP Server on the Master PC where Tally Prime runs.
  After setup, Tally data is accessible over the internet through a secure
  Cloudflare Tunnel — your VPS / WhatsApp bot connects to THIS.

REQUIREMENTS
  • Windows 8.1 / 10 / 11
  • Tally Prime running with Client/Server port 9000 enabled
  • Internet connection (for Node.js install + Cloudflare tunnel)

================================================================================
  FOLLOW THESE STEPS IN ORDER
================================================================================

STEP 1: Install Node.js (if not already installed)
  Double-click:  step1-install-node.bat
  This opens the Node.js download page. Install the LTS version.
  After install, close and reopen any command prompt windows.

STEP 2: Install MCP Server Dependencies
  Double-click:  step2-install-deps.bat
  This runs "npm install" in the tally-mcp folder to get all packages.

STEP 3: Test Tally Connectivity (local, no internet needed)
  Double-click:  step3-test-local.bat
  This checks:
    • Is port 9000 open? (Tally listening)
    • Does Tally respond to HTTP?
    • Does the MCP server start and list tools?
  ALL THREE must pass before proceeding.

STEP 4: Start MCP Server
  Double-click:  step4-start-mcp-server.bat
  This runs the HTTP MCP server on port 3000.
  Keep this window open — the server runs until you close it.

STEP 5: Quick Tunnel Test (temporary URL)
  Double-click:  step5-quick-tunnel.bat
  This creates a TEMPORARY Cloudflare tunnel (no account needed).
  It will print a URL like: https://random-words.trycloudflare.com
  Test that URL from your PHONE or another computer.
  If it responds, the full chain works: Internet → Tunnel → MCP → Tally.

STEP 6: Tell your team the tunnel URL
  Send the URL from Step 5 to whoever is setting up the VPS.
  For permanent setup: configure a named tunnel in Cloudflare Zero Trust
  dashboard pointing to http://localhost:3000 (NOT 9000).

================================================================================
  FOLDER CONTENTS
================================================================================

  README.txt              — This file
  step1-install-node.bat  — Opens Node.js download page
  step2-install-deps.bat  — npm install for MCP server
  step3-test-local.bat    — Test Tally + MCP locally
  step4-start-mcp-server.bat — Run MCP HTTP server (port 3000)
  step5-quick-tunnel.bat  — Temporary cloudflare tunnel
  Test-Local.ps1          — PowerShell script used by step3
  tally-mcp/              — The Tally MCP Server files
    dist/                 — Compiled server code
    pull/                 — XML report templates
    node_modules/         — (created by step2)
    package.json          — Dependencies
    .env                  — Configuration (edit PASSWORD etc.)
    authorize.html        — OAuth login page

================================================================================
  IMPORTANT NOTES
================================================================================

  • The PERMANENT tunnel should point to port 3000 (MCP server),
    NOT port 9000 (Tally XML). Change your existing tunnel if needed.

  • The .env file in tally-mcp/ has PASSWORD=password by default.
    Change this to a strong password for production.

  • The Master PC must be ON with Tally running for the bot to work.

  • RAM usage: Node.js MCP (~100MB) + cloudflared (~50MB) = ~150MB total.
    Fine for a 4GB machine alongside Tally.

================================================================================
