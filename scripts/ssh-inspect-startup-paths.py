"""One-shot: show Windows Startup entries and MCP-related paths on Master PC."""
from __future__ import annotations

import base64
import os
import sys

try:
    import paramiko
except ImportError:
    print("pip install paramiko", file=sys.stderr)
    sys.exit(2)

HOST = os.environ.get("EMILDA_MASTER_SSH_HOST", "192.168.1.40")
USER = os.environ.get("EMILDA_MASTER_SSH_USER", "user")
PASSWORD = os.environ.get("EMILDA_MASTER_SSH_PASSWORD", "")

PS = r"""
Write-Host "=== User Startup ($env:APPDATA\...\Startup) ==="
$u = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
if (Test-Path $u) {
  Get-ChildItem -LiteralPath $u -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "--- $($_.Name) ---"
    Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
  }
} else { Write-Host "(missing)" }

Write-Host "`n=== All-users Startup ==="
$all = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"
if (Test-Path $all) {
  Get-ChildItem -LiteralPath $all -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "--- $($_.Name) ---"
    Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
  }
}

Write-Host "`n=== H:\tech top-level ==="
cmd /c "dir /b H:\tech 2>&1"

Write-Host "`n=== node listening (3000 / 9000) ==="
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 3000, 9000 } |
  Select-Object LocalAddress, LocalPort, OwningProcess |
  Format-Table -AutoSize
foreach ($p in @(3000, 9000)) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    $pid = $c.OwningProcess
    $line = (Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue).CommandLine
    Write-Host "Port $p PID $pid : $line"
  }
}

Write-Host "`n=== cloudflared config.yml (if present) ==="
$cf = @(
  "$env:USERPROFILE\.cloudflared\config.yml",
  "C:\Users\user\.cloudflared\config.yml"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($cf) { Get-Content -LiteralPath $cf -Raw } else { Write-Host "(not found)" }
"""


def main() -> None:
    if not PASSWORD:
        print("Set EMILDA_MASTER_SSH_PASSWORD", file=sys.stderr)
        sys.exit(2)
    enc = base64.b64encode(PS.encode("utf-16-le")).decode("ascii")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST,
        username=USER,
        password=PASSWORD,
        timeout=25,
        allow_agent=False,
        look_for_keys=False,
    )
    try:
        stdin, stdout, stderr = client.exec_command(
            f"powershell -NoProfile -EncodedCommand {enc}", timeout=120
        )
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        sys.stdout.write(out)
        if err.strip():
            sys.stderr.write(err)
    finally:
        client.close()


if __name__ == "__main__":
    main()
