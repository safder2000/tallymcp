# Master PC local tests: Tally port + HTTP + MCP server start
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File Test-Local.ps1
#         powershell ... -File Test-Local.ps1 -NonInteractive   (no Read-Host; for SSH/automation)
param(
    [switch]$NonInteractive
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$mcpDir = Join-Path $scriptDir "tally-mcp"
$passed = 0
$failed = 0

Write-Host "`n========== Master PC Local Tests ==========`n" -ForegroundColor Cyan

# --- TEST 1: TCP 9000 ---
Write-Host "[1/3] TCP connect to 127.0.0.1:9000 (Tally XML port)..." -ForegroundColor Yellow
try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect("127.0.0.1", 9000, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(5000, $false)) { throw "Timeout" }
    $c.EndConnect($iar)
    $c.Close()
    Write-Host "      PASS: Port 9000 is open.`n" -ForegroundColor Green
    $passed++
} catch {
    Write-Host "      FAIL: Port 9000 closed or refused." -ForegroundColor Red
    Write-Host "      Is Tally Prime running with Server mode on port 9000?" -ForegroundColor Red
    Write-Host "      (F1 > Settings > Connectivity > Act as Server, Port 9000)`n" -ForegroundColor Red
    $failed++
}

# --- TEST 2: HTTP Tally banner ---
Write-Host "[2/3] HTTP GET http://127.0.0.1:9000/ ..." -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:9000/" -UseBasicParsing -TimeoutSec 10
    $t = $r.Content
    if ($t -match "TallyPrime|Tally|RESPONSE") {
        Write-Host "      PASS: Tally responded.`n" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "      WARN: Got HTTP response but body doesn't look like Tally.`n" -ForegroundColor Yellow
        $passed++
    }
    Write-Host "      Response: $($t.Substring(0, [Math]::Min(200, $t.Length)))`n"
} catch {
    Write-Host "      FAIL: Could not HTTP GET localhost:9000." -ForegroundColor Red
    Write-Host "      Error: $_`n" -ForegroundColor Red
    $failed++
}

# --- TEST 3: MCP Server quick start ---
Write-Host "[3/3] MCP Server start test (list-master company)..." -ForegroundColor Yellow
Write-Host "      Note: Either open any company in Tally, OR set TALLY_DEFAULT_COMPANY in tally-mcp\.env (exact name)." -ForegroundColor DarkGray

$nodeExe = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeExe) {
    Write-Host "      SKIP: Node.js not found. Run step1-install-node.bat first.`n" -ForegroundColor Gray
} else {
    $indexMjs = Join-Path $mcpDir "dist\index.mjs"
    $nodeModules = Join-Path $mcpDir "node_modules"

    if (-not (Test-Path $indexMjs)) {
        Write-Host "      SKIP: $indexMjs not found. Is tally-mcp folder present?`n" -ForegroundColor Gray
    } elseif (-not (Test-Path $nodeModules)) {
        Write-Host "      SKIP: node_modules not found. Run step2-install-deps.bat first.`n" -ForegroundColor Yellow
    } else {
        # Optional: company context for Tally XML (avoids "Could not find Company ''" when Gateway has no active company)
        $envPath = Join-Path $mcpDir ".env"
        if (Test-Path $envPath) {
            Get-Content $envPath | ForEach-Object {
                if ($_ -match '^\s*TALLY_DEFAULT_COMPANY\s*=\s*(.+)\s*$') {
                    $v = $Matches[1].Trim().Trim('"').Trim("'")
                    if ($v) { $env:TALLY_DEFAULT_COMPANY = $v }
                }
            }
        }

        # Write test script INSIDE tally-mcp so it can find node_modules
        $testScript = @"
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node', args: ['dist/index.mjs'], stderr: 'inherit',
});
const client = new Client({ name: 'test', version: '1.0.0' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const args = { collection: 'company' };
  const dc = (process.env.TALLY_DEFAULT_COMPANY || '').trim();
  if (dc) args.targetCompany = dc;
  const r = await client.callTool({ name: 'list-master', arguments: args });
  const text = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  if (r.isError) { console.log('ERROR:' + text); process.exit(1); }
  console.log('TOOLS:' + tools.length);
  console.log('DATA:' + text.substring(0, 500));
} catch(e) { console.log('EXCEPTION:' + e.message); process.exit(1); }
finally { try { await client.close(); } catch {} }
"@

        $tmpFile = Join-Path $mcpDir "_emilda-test.mjs"
        $testScript | Out-File -Encoding utf8 -FilePath $tmpFile -Force

        try {
            $prevDir = Get-Location
            Set-Location $mcpDir
            if ($env:TALLY_DEFAULT_COMPANY) {
                Write-Host "      Using TALLY_DEFAULT_COMPANY from tally-mcp\.env for this test." -ForegroundColor DarkGray
            }
            $env:TALLY_DEBUG = '1'
            $output = & node "_emilda-test.mjs" 2>&1 | Out-String
            Remove-Item Env:TALLY_DEBUG -ErrorAction SilentlyContinue
            Set-Location $prevDir
            $output = $output.Trim()

            if ($output -match "TOOLS:(\d+)") {
                $toolCount = $Matches[1]
                Write-Host "      PASS: MCP started, $toolCount tools registered." -ForegroundColor Green
                $passed++

                if ($output -match "DATA:(.+)") {
                    $data = $Matches[1].Trim()
                    if ($data.Length -gt 5) {
                        Write-Host "      Companies from Tally:`n      $data`n" -ForegroundColor Green
                    } else {
                        Write-Host "      (No companies returned - is a company loaded in Tally?)`n" -ForegroundColor Yellow
                    }
                }
            } elseif ($output -match "ERROR:(.+)") {
                Write-Host "      FAIL: MCP tool error: $($Matches[1])" -ForegroundColor Red
                $failed++
            } elseif ($output -match "EXCEPTION:(.+)") {
                Write-Host "      FAIL: $($Matches[1])" -ForegroundColor Red
                $failed++
            } else {
                Write-Host "      FAIL: Unexpected output:`n      $output`n" -ForegroundColor Red
                $failed++
            }
        } catch {
            Write-Host "      FAIL: $_`n" -ForegroundColor Red
            $failed++
        } finally {
            Remove-Item $tmpFile -ErrorAction SilentlyContinue
        }
    }
}

# --- Summary ---
Write-Host "========== Results: $passed passed, $failed failed ==========" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })

if ($failed -eq 0) {
    Write-Host "`nAll local tests passed! You can proceed to:`n  step4-start-mcp-server.bat (start MCP HTTP server)`n  step5-quick-tunnel.bat (temporary public URL)`n" -ForegroundColor Green
} else {
    Write-Host "`nFix the failures above before proceeding.`n" -ForegroundColor Red
}

if (-not $NonInteractive) {
    Read-Host "Press Enter to close"
}
