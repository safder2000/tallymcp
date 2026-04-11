# Full context: WhatsApp bot (LLM) + Tally MCP + Master PC test kit

**Purpose:** Copy this entire file into your **WhatsApp bot** repo (or give it to another agent). It combines:

1. A **paste-ready system prompt** for the LLM that talks to Tally via MCP  
2. **How Tally data is laid out** (so the bot does not confuse FY, company books, and reports)  
3. **Master PC test kit** overview (what lives on the office PC)  
4. **`scripts/`** folder in the **tally git repo** (dev machine automation — not shipped on Master PC by default)

**Source repo:** `tally` (Tally Prime MCP Server fork). Paths below are relative to that repo unless stated otherwise.

---

## 1. Paste-ready system prompt (WhatsApp bot / Claude)

Use as **system** or **developer** instructions for any agent that calls the **HTTP MCP** (OAuth + JSON-RPC `tools/call`). Adjust the public base URL if yours differs.

```
You help users query Tally Prime accounting data through an MCP server. You MUST use the provided MCP tools; do not invent numbers.

DATA MODEL (Tally — read only)
- Each "company" in Tally is a separate accounting book with an exact display name (string). Names often include FY text, e.g. "KMCT College of Architecture - (2022-2023) - (from 1-Apr-22)".
- Optional argument on almost every tool: targetCompany (exact string). If omitted, Tally uses the company currently active in the Tally UI for that XML request. If set, the server scopes that single request to that book (SVCURRENTCOMPANY in XML).
- Companies must be LOADED in the running Tally session (user opened them with password in Tally) for targetCompany to work. If a company exists only on disk but is not loaded, switching to it will fail ("Could not set SVCurrentCompany" or similar).
- Discovery: call list-master with collection=company and NO targetCompany to list companies Tally exposes in the current session (often all loaded books). Use those exact strings in targetCompany later.
- Older pattern: separate folders per FY (e.g. .../2021-2022 vs .../2022-2023) can mean different Tally "company" files per year. Newer pattern: a book named for 2022-23 may still contain vouchers for later FYs (e.g. through 2025-26) in the SAME company — data is not split by year inside that book. Always use report date ranges (fromDate, toDate) to select the period.
- There is no separate "database table per year" in the MCP API: trial-balance, profit-loss, balance-sheet, ledger-account, etc. all take explicit dates. Same company name + different date ranges = different periods.

WORKFLOW
1) If user asks about a specific college/entity, resolve the exact targetCompany via list-master (company) if unknown.
2) For aggregates and rankings, prefer: chart-of-accounts or trial-balance (or other report tool) → response includes a tableID → then query-database with SQL on that tableID. Tables expire after ~15 minutes.
3) For one ledger: list-master (ledger) with targetCompany if needed, then ledger-balance or ledger-account with exact ledgerName and dates.
4) Dates: use YYYY-MM-DD. Indian FY example: 2024-04-01 to 2025-03-31 for FY 2024-25.
5) Sign conventions (from tool descriptions): trial-balance style amounts — debits often negative, credits positive in some columns; read tool output column definitions carefully.

FAILURES
- "Could not find Company ''" → no company open in Tally (Gateway). User must open/load a company on the Master PC.
- "Could not set SVCurrentCompany" → name wrong or company not loaded in Tally.
- "Tally request failed" / connection errors → Master PC off, Tally closed, tunnel down, or MCP not running.

You do not post vouchers or change masters unless explicitly given write tools (this stack is read-oriented).
```

---

## 2. Architecture chain (one paragraph)

**WhatsApp user → your bot (VPS) → HTTPS public URL → Cloudflare tunnel → `localhost:3000` MCP HTTP server (`node dist/server.mjs`) → `localhost:9000` Tally Prime XML port.**

- **Port 3000:** MCP (OAuth, `/mcp` JSON-RPC, tools).  
- **Port 9000:** Tally XML only on the Master PC; **do not** expose 9000 to the internet; tunnel targets **3000**.

---

## 3. Master PC test kit (what it is)

**Location on office PC:** e.g. `H:\tech\master-pc-test-kit\` (path varies).

**Role:** Run the **Tally MCP Server** next to Tally Prime so remote clients (VPS, bot) can call tools over HTTP.

**Steps (from `master-pc-test-kit/README.txt`):**

| Step | Action |
|------|--------|
| 1 | Install Node.js LTS (`step1-install-node.bat`) |
| 2 | `npm install` in `tally-mcp` (`step2-install-deps.bat`) |
| 3 | Local test: Tally :9000 + MCP (`step3-test-local.bat` / `Test-Local.ps1`) |
| 4 | Start MCP HTTP server (`step4-start-mcp-server.bat`) — keep window open |
| 5 | Optional: quick Cloudflare trycloudflare tunnel (`step5-quick-tunnel.bat`) |

**Folder layout:**

```
master-pc-test-kit/
  README.txt
  INSTRUCTIONS-STEP2-AND-STEP3.md   ← detailed troubleshooting
  step1..step5 *.bat
  Test-Local.ps1
  tally-mcp/
    .env                 ← PASSWORD (MCP web), MCP_DOMAIN, optional TALLY_*
    dist/                ← server.mjs, mcp.mjs, tally.mjs, ...
    pull/                ← XML templates + config.json
    authorize.html
    package.json
```

**Important `.env` keys (`tally-mcp/.env`):**

| Variable | Role |
|----------|------|
| `PASSWORD` | Password for **MCP web** OAuth authorize flow (not Tally company password). |
| `MCP_DOMAIN` | Public URL of this MCP, e.g. `https://your-domain.com` (for OAuth redirects). |
| `TALLY_DEFAULT_COMPANY` | Optional exact company name when Gateway has no selection (automation/bootstrap). |
| `TALLY_SVUSERNAME` / `TALLY_SVPASSWORD` | Optional **Tally Security** XML auth injected into each export if Tally requires it. |

**Operational:** Master PC must stay on with **Tally running** and **companies loaded** for multi-company access. Restarting Tally clears loaded companies until someone opens them again.

Full prose for Steps 2–3, failures, and F1 connectivity: see **`master-pc-test-kit/INSTRUCTIONS-STEP2-AND-STEP3.md`** in the repo.

---

## 4. MCP tools the bot uses (names only)

Registered tools include (exact names for `tools/call`):

- `query-database` — SQL on DuckDB cache (needs `tableID` from another tool).  
- `list-master` — collections: `group`, `ledger`, `company`, `stockitem`, etc.  
- `chart-of-accounts`, `trial-balance`, `profit-loss`, `balance-sheet`  
- `ledger-balance`, `ledger-account`, `stock-item-balance`, `stock-item-account`, `stock-summary`  
- `bills-outstanding`  

**OAuth:** client registration + authorize + token, then `initialize` on `/mcp` to get `mcp-session-id` header, then `tools/call`. Reference implementation: `scripts/test-mcp-public-queries.mjs` in the tally repo.

---

## 5. `scripts/` folder (tally git repo — developer / CI)

These live in **`scripts/`** at the repo root. They are for **developers** testing or managing the Master PC over SSH; they are **not** required inside `master-pc-test-kit` on the office PC unless you copy them deliberately.

| Script | Purpose |
|--------|---------|
| `test-mcp-public-queries.mjs` | OAuth + full MCP tool smoke test against a public base URL. Args: URL, optional `--no-target-company`. |
| `test-mcp-public-company-switch.mjs` | Public MCP: company discovery + trial-balance / chart probes. |
| `probe-all-companies.mjs` | Public MCP: list loaded companies + chart-of-accounts per known name. |
| `probe-fy-ranges-readonly.mjs` | Read-only: trial-balance + SQL sums across FY ranges for one `targetCompany`. |
| `test-company-switch-trace.mjs` | Local: `handlePull` only (no OAuth), needs Tally reachable from this machine. |
| `test-mcp-tunnel.mjs` | MCP against a tunnel URL. |
| `test-mcp-remote.mjs` | Local stdio MCP with `TALLY_HOST`/`TALLY_PORT` pointing at remote Tally. |
| `debug-pull.mjs` | Local `handlePull('list-master', company)` for debugging. |
| `probe-tally-http.mjs` | Probe Tally HTTP banner on configured host/port. |
| `ssh-master-readonly-probe.py` | Paramiko: read-only SSH commands on Master PC (`EMILDA_MASTER_SSH_PASSWORD`, etc.). |
| `ssh-master-git-pull.py` | SSH: git pull on Master PC. |
| `ssh-master-deploy-and-test.py` | SFTP dist/pull/kit to Master PC, touch timestamps, optional restart/tests. |
| `ssh-verify-mcp-http.py` | SSH: verify MCP HTTP. |
| `ssh-master-ports.py` | SSH: port checks. |
| `ssh-inspect-startup-paths.py` | SSH: inspect startup paths. |
| `ssh-update-env.py` | SSH: upload `.env` template (maintainer use). |
| `ssh-create-startup.py` / `ssh-fix-mcp-startup.py` / `ssh-cleanup-startup.py` / `ssh-master-setup-autostart.py` | SSH: Windows startup / MCP launch helpers. |
| `ssh-tally-list-companies-raw.py` | SSH on PC: POST list-of-companies XML to Tally :9000, print raw/snippet. |

**Typical env for SSH scripts:** `EMILDA_MASTER_SSH_HOST`, `EMILDA_MASTER_SSH_USER`, `EMILDA_MASTER_SSH_PASSWORD`, optionally `EMILDA_MASTER_KIT`.

---

## 6. Confirmed behaviour (for bot answers)

- **Multi-year in one book:** For at least one production book (`KMCT College of Architecture - (2022-2023) - (from 1-Apr-22)`), trial-balance with different `fromDate`/`toDate` showed real activity across FY22-23 through FY25-26. So "data till 26" means **vouchers dated in those years inside that company**, not a separate MCP company per year.  
- **Loaded vs folder list:** MCP can switch only among companies **loaded** in Tally; the full folder list from "List of Companies" disk browser is larger until books are opened.

---

## 7. What this file does NOT contain

- No production passwords (set in `.env` on the Master PC and in your bot secrets).  
- No WhatsApp provider API keys.  
- The **WhatsApp bot application code** is not in the tally repo; wire this document into whatever service calls Claude + MCP.

---

*Generated as a single handoff artifact from the Emilda Tally MCP project. Copy freely into `whatsapp-bot/docs/` or similar.*
