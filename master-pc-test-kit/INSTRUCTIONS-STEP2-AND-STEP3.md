# Master PC Setup — Step 2 & Step 3

## Prerequisites
- **Node.js** is already installed (confirmed: v24.14.1)
- **master-pc-test-kit** folder is extracted somewhere (e.g. `H:\tech\master-pc-test-kit\`)
- **Tally Prime** must be running with XML server on port **9000**
- For **Test 3**, Tally needs a **company context**. Either:
  - **Open any one company** in Tally (not only the Gateway list), or
  - Set **`TALLY_DEFAULT_COMPANY`** in `tally-mcp\.env` to the **exact** company name (as shown in Tally). Step 3 then passes without someone clicking into a company first.

---

## Multiple companies — do you open each one manually every time?

**No — not for normal MCP / bot use.**

- In the **Tally window**, you normally work in **one active company at a time**. You are not meant to “open all eight at once” in one session.
- The MCP tools already support an optional argument **`targetCompany`** (exact name string). Each request can say which company the data is for. Tally uses that in the XML (`SVCURRENTCOMPANY`) for **that call only**, so the **WhatsApp / Claude side can switch companies per question** without someone clicking Tally every time — as long as the name is exact (use `list-master` with `collection: company` once to discover names, or your `TALLY_DEFAULT_COMPANY` for bootstrap when the Gateway has no active company).
- **`TALLY_DEFAULT_COMPANY` in `.env`** is only a **fallback** for automation/tests when nobody has selected a company in the UI. It does **not** lock you to one company forever; other tools can still pass **`targetCompany`** for the other seven.

### Company passwords & Tally Security

- **Company password** (prompt when you choose a company from the list) and **Tally Security** (username/password for using Tally) are not the same thing, but both can block unattended access.
- **Simplest day-to-day:** On the Master PC, start Tally once, enter passwords, and **leave one company open** during working hours. XML on `localhost:9000` then usually works for that session without typing passwords again for every MCP call.
- **If Tally still rejects XML until a user logs in:** Set optional **`TALLY_SVUSERNAME`** and **`TALLY_SVPASSWORD`** in `tally-mcp\.env` (the **Tally Security** user, as used in Tally’s own login — *not* the MCP web `PASSWORD`). The server will add `SVUSERNAME` / `SVPASSWORD` into each export XML when both are set. Treat this like a secret; restrict who can read `.env`.
- **“Migration Required”** companies must be **migrated inside Tally** before they can be used; pick a company **without** that flag for first tests (e.g. KMCT College of Architecture, KMCT College of Engineering, KMCT Polytechnic College, National Hospital College of Nursing if those show no migration warning).
- **Company names in `.env` / `targetCompany`:** Use the **exact name Tally uses** (usually the text **before** the bracket, e.g. `KMCT College of Architecture` — not ` (100002)` unless Tally’s master actually stores it that way). If unsure, open one company and copy the name from the title bar or from Tally’s company alter screen.

### Data folder `G:\` vs kit on `H:\`

- **`G:\TALLY DATA PRIME\...`** is where Tally stores **company data**. **`H:\tech\...`** (or similar) is only where you put this **test kit** — they are unrelated. No need to move the kit to `G:\`.

---

## STEP 2: Install MCP Server Dependencies

### What this does
Runs `npm install` inside the `tally-mcp` subfolder to download all required Node.js packages (~50MB). This only needs to be done **once**.

### How to run
1. Double-click **`step2-install-deps.bat`**
2. Wait for it to finish (1-2 minutes depending on internet speed)

### What SUCCESS looks like
```
Running: npm install --omit=dev
This may take a minute...

added 95 packages in 45s

SUCCESS: Dependencies installed.
```

### What FAILURE looks like and how to fix

**Error: `npm ERR! code ENOENT` or `npm not found`**
- Node.js may not be in PATH. Close ALL command prompt windows, open a NEW one, type `node -v`. If it says "not recognized", reinstall Node.js from https://nodejs.org and make sure "Add to PATH" is checked during install.

**Error: `npm ERR! network` or timeout**
- Internet connection issue. Check if this PC can open websites. Try again.

**Error: `node-gyp rebuild` / `gyp ERR! find VS`**
- This means a package needs C++ build tools. This should NOT happen with our dependencies. If it does:
  1. Open PowerShell as Administrator
  2. Run: `npm install -g windows-build-tools`
  3. Try step2 again

**Error: `EPERM` or `permission denied`**
- Right-click `step2-install-deps.bat` → "Run as administrator"

### How to verify it worked
Open a command prompt, navigate to the tally-mcp folder:
```cmd
cd H:\tech\master-pc-test-kit\tally-mcp
dir node_modules
```
You should see folders like `@modelcontextprotocol`, `express`, `nunjucks`, etc.

---

## STEP 3: Test Local Connectivity

### What this does
Runs 3 automated tests:
1. **TCP port 9000** — Can we connect to Tally's XML server port?
2. **HTTP response** — Does Tally respond with its banner XML?
3. **MCP Server** — Can the MCP start, discover tools, and query Tally for company names?

### How to run
1. Make sure **Tally Prime is OPEN** on this PC with at least one company loaded
2. Double-click **`step3-test-local.bat`**

### What SUCCESS looks like (all 3 pass)
```
========== Master PC Local Tests ==========

[1/3] TCP connect to 127.0.0.1:9000 (Tally XML port)...
      PASS: Port 9000 is open.

[2/3] HTTP GET http://127.0.0.1:9000/ ...
      PASS: Tally responded.
      Response: <RESPONSE>TallyPrime Server is Running</RESPONSE>

[3/3] MCP Server start test (list-master company)...
      PASS: MCP started, 12 tools registered.
      Companies from Tally:
      name
      KMCT Nucleus Pvt Ltd    <-- (your actual company name will appear here)

========== Results: 3 passed, 0 failed ==========

All local tests passed! You can proceed to:
  step4-start-mcp-server.bat (start MCP HTTP server)
  step5-quick-tunnel.bat (temporary public URL)
```

### Common failures and fixes

---

#### TEST 1 FAIL: "Port 9000 closed or refused"

**Cause:** Tally Prime is not running, or its XML server port is not enabled.

**Fix:**
1. Open Tally Prime on this PC
2. Press **F1** (Help) → **Settings** → **Connectivity**
3. Go to **Client/Server Configuration**
4. Set **"TallyPrime acts as"** = **Both** (or **Server**)
5. Set **Port** = **9000**
6. Save and **restart Tally Prime**
7. Run step3 again

**Note:** Tally must be fully open (not just the background service / SPSocketServer). The XML port only activates when the Tally GUI application is running.

---

#### TEST 2 FAIL: "Could not HTTP GET localhost:9000"

**Cause:** Usually same as Test 1 — Tally isn't listening on 9000.

**Fix:** Same as Test 1 above. If Test 1 passes but Test 2 fails:
- Windows Firewall might be blocking localhost connections (rare). Try:
  ```cmd
  curl http://localhost:9000
  ```
  If curl works but the test doesn't, it may be a PowerShell proxy issue. Try:
  ```powershell
  [System.Net.ServicePointManager]::SecurityProtocol = 'Tls12'
  Invoke-WebRequest -Uri "http://127.0.0.1:9000/" -UseBasicParsing
  ```

---

#### TEST 3 SKIP: "node_modules not found"

**Cause:** Step 2 was not run (or failed silently).

**Fix:** Run **`step2-install-deps.bat`** first, confirm it says "SUCCESS", then run step3 again.

---

#### TEST 3 FAIL: "Cannot find package '@modelcontextprotocol/sdk'"

**Cause:** Same as above — node_modules missing or incomplete.

**Fix:**
1. Open Command Prompt
2. Navigate to the tally-mcp folder:
   ```cmd
   cd H:\tech\master-pc-test-kit\tally-mcp
   ```
3. Delete node_modules and reinstall:
   ```cmd
   rmdir /s /q node_modules
   npm install --omit=dev
   ```
4. Run step3 again

---

#### TEST 3 FAIL: "Unexpected Tally response: missing DATA.ROW"

**Cause:** MCP connected to Tally and got a response, but the XML structure differs from what the parser expected. This has been fixed in the latest version — the parser now searches for the DATA node inside ENVELOPE wrappers too.

**Fix:**
1. Make sure you have the **latest zip** (re-download if needed)
2. Re-run `step2-install-deps.bat` to update node_modules
3. Make sure a **company is open/loaded** in Tally Prime (not just the gateway screen)
4. Run step3 again

If it still fails, the error message now includes the raw XML response for debugging. Share that output.

---

#### TEST 3 FAIL: "MCP tool error: Empty data received from Tally"

**Cause:** MCP started OK, connected to Tally, but Tally returned no data.

**Fix:** Open a company in Tally Prime. The XML port responds to requests but there's no active company to query.

---

#### TEST 3 FAIL: "Tally request failed" or "Unable to connect to Tally"

**Cause:** MCP started but couldn't reach Tally on localhost:9000.

**Fix:** Same as Test 1 — make sure Tally is running with Server mode on 9000.

---

#### TEST 3 FAIL: "EXCEPTION: ..." with a DuckDB error

**Cause:** DuckDB native module might not match the Node.js version/platform.

**Fix:**
1. Check Node version: `node -v` (should be v18, v20, or v22 — v24 is very new and may have compatibility issues)
2. If on v24, install v22 LTS instead from https://nodejs.org
3. Delete node_modules and reinstall:
   ```cmd
   cd H:\tech\master-pc-test-kit\tally-mcp
   rmdir /s /q node_modules
   npm install --omit=dev
   ```

---

## Quick manual test (no scripts needed)

If the bat files give trouble, you can test everything manually from Command Prompt:

```cmd
:: Test 1: Is Tally listening?
curl http://localhost:9000
:: Expected: <RESPONSE>TallyPrime Server is Running</RESPONSE>

:: Test 2: Does MCP start? (Ctrl+C to stop)
cd H:\tech\master-pc-test-kit\tally-mcp
node dist/index.mjs
:: Should start without errors (it waits for stdin input — that's normal for stdio mode)
:: Press Ctrl+C to stop

:: Test 3: Start HTTP MCP server
cd H:\tech\master-pc-test-kit\tally-mcp
node dist/server.mjs
:: Should print: "MCP Server listening on port 3000" or similar
:: Open browser: http://localhost:3000  — should show something (maybe OAuth page)
:: Press Ctrl+C to stop
```

---

## After all 3 tests pass

Move on to **step4** and **step5** as described in `README.txt`.

The goal is:
- **step4**: Start the MCP HTTP server permanently on port 3000
- **step5**: Create a temporary Cloudflare tunnel so the VPS can reach this MCP server

Once step5 shows a working URL (test from your phone), share that URL with the VPS setup person.

---

## Folder structure reference

```
master-pc-test-kit/
├── step1-install-node.bat        ← DONE (Node v24 installed)
├── step2-install-deps.bat        ← DO THIS NEXT
├── step3-test-local.bat          ← THEN THIS
├── step4-start-mcp-server.bat    ← After step3 passes
├── step5-quick-tunnel.bat        ← After step4 is running
├── Test-Local.ps1                ← Used by step3
├── README.txt                    ← Overview
├── INSTRUCTIONS-STEP2-AND-STEP3.md  ← THIS FILE
└── tally-mcp/                    ← The MCP server
    ├── dist/                     ← Compiled code (do not edit)
    │   ├── index.mjs             ← Stdio MCP (used by step3 test)
    │   ├── server.mjs            ← HTTP MCP (used by step4)
    │   ├── mcp.mjs               ← Tool definitions
    │   ├── tally.mjs             ← Tally XML communication
    │   └── ...
    ├── pull/                     ← XML templates for Tally reports
    ├── node_modules/             ← Created by step2 (npm install)
    ├── package.json              ← Dependencies list
    ├── package-lock.json         ← Exact versions
    ├── authorize.html            ← OAuth login page
    └── .env                      ← Config (PASSWORD, MCP_DOMAIN)
```
