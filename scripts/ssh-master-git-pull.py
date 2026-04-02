"""
On the Master PC (Windows): ensure Git exists, clone or pull tallymcp repo, npm install, tsc, restart MCP.

Requires: pip install paramiko

  set EMILDA_MASTER_SSH_PASSWORD=...
Optional:
  set EMILDA_MASTER_SSH_HOST=192.168.1.40
  set EMILDA_MASTER_SSH_USER=user
  set EMILDA_GIT_DIR=H:\\tech\\tallymcp          (clone/pull target; created if missing)
  set EMILDA_GIT_URL=https://github.com/safder2000/tallymcp.git
  set EMILDA_TRY_WINGET_GIT=1                   (try winget install Git.Git if git missing)
  set EMILDA_SKIP_RESTART=1
  set EMILDA_UPDATE_STARTUP_VBS=1   rewrite Startup\\start-mcp-server.vbs to run repo start-mcp-server.bat (align with git path)

Security: Do not commit .env or secrets to GitHub. If they were pushed, remove from repo history and rotate keys.
Repo: https://github.com/safder2000/tallymcp
"""
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
GIT_URL = os.environ.get(
    "EMILDA_GIT_URL", "https://github.com/safder2000/tallymcp.git"
).strip()
GIT_DIR = os.environ.get("EMILDA_GIT_DIR", r"H:\tech\tallymcp").strip().rstrip("\\/")


def run_ps_encoded(client: paramiko.SSHClient, script: str, timeout: int = 300) -> str:
    enc = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    cmd = f"powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand {enc}"
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if err and "CLIXML" not in err:
        print("stderr:", err[:2000], file=sys.stderr)
    return out


def run_cmd(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> tuple[int, str, str]:
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    return (
        code,
        stdout.read().decode("utf-8", errors="replace"),
        stderr.read().decode("utf-8", errors="replace"),
    )


def restart_mcp_repo_root(client: paramiko.SSHClient, repo_bs: str) -> None:
    """MCP entry is repo_root\\dist\\server.mjs (not master-pc-test-kit layout)."""
    r = repo_bs.replace("'", "''")
    ps = f"""
$root = '{r}'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {{
  $cl = $_.CommandLine
  if ($null -eq $cl) {{ return }}
  if ($cl -match 'server\\.mjs') {{
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Output ('KILLED_PID=' + $_.ProcessId)
  }}
}}
Start-Sleep -Seconds 2
$srv = Join-Path $root 'dist\\server.mjs'
if (-not (Test-Path -LiteralPath $srv)) {{
  Write-Output 'START_SKIPPED_NO_DIST_SERVER'
  exit 0
}}
# Use absolute path to server.mjs — on some sessions relative "dist\\server.mjs" resolves from wrong cwd.
$arg = '"' + $srv + '"'
$p = Start-Process -FilePath 'node.exe' -ArgumentList $arg -WorkingDirectory $root -WindowStyle Hidden -PassThru
Write-Output ('STARTED_PID=' + $p.Id)
"""
    print("--- Restart MCP (repo root dist\\server.mjs) ---")
    out = run_ps_encoded(client, ps, timeout=120)
    for ln in out.splitlines():
        print(" ", ln.strip())


def main() -> int:
    if not PASSWORD:
        print("Set EMILDA_MASTER_SSH_PASSWORD", file=sys.stderr)
        return 2

    git_dir_bs = GIT_DIR if "\\" in GIT_DIR else GIT_DIR.replace("/", "\\")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            HOST,
            username=USER,
            password=PASSWORD,
            timeout=25,
            allow_agent=False,
            look_for_keys=False,
        )
    except (TimeoutError, OSError) as e:
        print(f"SSH failed: {e}", file=sys.stderr)
        return 3

    try:
        # --- Git present? ---
        code, out, err = run_cmd(client, "cmd /c git --version", timeout=30)
        if code != 0 or "git version" not in (out + err).lower():
            print("Git not found on Master PC.")
            if os.environ.get("EMILDA_TRY_WINGET_GIT", "").strip() in ("1", "true", "yes"):
                print("Trying: winget install Git.Git ... (may need admin approval once)")
                run_cmd(
                    client,
                    "winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements",
                    timeout=300,
                )
                code, out, err = run_cmd(client, "cmd /c git --version", timeout=30)
            if code != 0 or "git version" not in (out + err).lower():
                print(
                    "Install Git manually on the Master PC, then re-run:\n"
                    "  https://git-scm.com/download/win\n"
                    "  or: winget install Git.Git",
                    file=sys.stderr,
                )
                return 4
        print("Git:", (out + err).strip().splitlines()[0] if (out or err) else "ok")

        # --- Clone or pull (PowerShell for paths) ---
        url_esc = GIT_URL.replace("'", "''")
        dir_esc = git_dir_bs.replace("'", "''")
        ps_git = rf"""
$ErrorActionPreference = 'Stop'
$url = '{url_esc}'
$dir = '{dir_esc}'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Location -LiteralPath $dir
if (-not (Test-Path -LiteralPath (Join-Path $dir '.git'))) {{
  Write-Output 'CLONE_START'
  git clone $url .
  Write-Output 'CLONE_DONE'
}} else {{
  Write-Output 'PULL_START'
  git pull
  Write-Output 'PULL_DONE'
}}
Write-Output 'GIT_OK'
"""
        print(f"--- Git (dir={git_dir_bs}) ---")
        gout = run_ps_encoded(client, ps_git, timeout=600)
        for ln in gout.splitlines():
            print(" ", ln.strip())
        if "GIT_OK" not in gout:
            print("Git clone/pull may have failed — check output above.", file=sys.stderr)
            return 5

        # --- npm install + tsc ---
        npm_cmd = (
            f'cmd /c "cd /d "{git_dir_bs}" && npm install && npx tsc -p tsconfig.json"'
        )
        print("--- npm install + tsc (can take several minutes) ---")
        print("RUN:", npm_cmd)
        _, no, ne = client.exec_command(npm_cmd, timeout=600)
        npm_out = no.read().decode("utf-8", errors="replace")
        npm_err = ne.read().decode("utf-8", errors="replace")
        ex = no.channel.recv_exit_status()
        if npm_out.strip():
            print(npm_out[-4000:] if len(npm_out) > 4000 else npm_out)
        if npm_err.strip():
            print("stderr:", npm_err[-2000:], file=sys.stderr)
        if ex != 0:
            print(f"npm/tsc exited {ex}", file=sys.stderr)
            return 6

        # --- start-mcp-server.bat at repo root (for manual double-click) ---
        srv_js = f"{git_dir_bs}\\dist\\server.mjs"
        bat = (
            "@echo off\r\n"
            f'cd /d "{git_dir_bs}"\r\n'
            "echo Tally MCP from git repo...\r\n"
            f'node "{srv_js}"\r\n'
        )
        sftp = client.open_sftp()
        try:
            bat_path = f"{git_dir_bs}/start-mcp-server.bat".replace("\\", "/")
            with sftp.open(bat_path, "w") as f:
                f.write(bat)
            print("Wrote", bat_path)
        finally:
            sftp.close()

        upd_vbs = os.environ.get("EMILDA_UPDATE_STARTUP_VBS", "").strip().lower()
        if upd_vbs in ("1", "true", "yes"):
            bat_for_vbs = f"{git_dir_bs}\\start-mcp-server.bat"
            vbs_body = (
                'Set WshShell = CreateObject("WScript.Shell")\r\n'
                f'WshShell.Run """{bat_for_vbs}""", 0, False\r\n'
            )
            ps_vbs = (
                "$dest = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup\\start-mcp-server.vbs'\n"
                "$content = @'\n"
                + vbs_body
                + "'@\n"
                "Set-Content -LiteralPath $dest -Value $content -Encoding ASCII\n"
                "Write-Output ('WROTE_STARTUP_VBS=' + $dest)\n"
            )
            print("--- Update Startup start-mcp-server.vbs → git bat ---")
            vout = run_ps_encoded(client, ps_vbs, timeout=60)
            for ln in vout.splitlines():
                print(" ", ln.strip())

        if os.environ.get("EMILDA_SKIP_RESTART", "").strip() not in ("1", "true", "yes"):
            restart_mcp_repo_root(client, git_dir_bs)
        else:
            print("EMILDA_SKIP_RESTART set — start MCP manually.")

        print("\n=== Git pull deploy complete ===")
        print(f"MCP should run from: {git_dir_bs}\\dist\\server.mjs")
        print(
            "Update Cloudflare tunnel / shortcuts if they still pointed at an old folder "
            "(e.g. master-pc-test-kit\\tally-mcp)."
        )
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
