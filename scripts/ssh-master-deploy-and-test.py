"""
Push latest dist/*.mjs + pull/* + test kit files to Master PC, run tests, restart MCP.

Requires: pip install paramiko

  set EMILDA_MASTER_SSH_PASSWORD=...
Optional:
  set EMILDA_MASTER_SSH_HOST=192.168.1.40
  set EMILDA_MASTER_SSH_USER=user
  set EMILDA_MASTER_KIT=H:\\tech\\v4\\master-pc-test-kit   (if set, skips auto-detect)
  set EMILDA_SKIP_RESTART=1    (upload + test only)
  set EMILDA_SKIP_PROBE=1      (skip probe-list-master — can be slow)
  set EMILDA_SKIP_TOUCH=1      (do not bump file timestamps after SFTP)
  set EMILDA_TOUCH_PATHS=H:\\tech\\v3\\...\\server.mjs;H:\\tech\\v4\\...\\server.mjs
        (extra paths to "touch" — semicolon-separated — so discovery picks newest kit)

After SFTP, this script runs PowerShell on the Master PC to set LastWriteTime = now on
deployed dist\\*.mjs and start-mcp-server.bat (Unix "touch" equivalent on Windows).

Windows has no nano over SSH by default — quick edits over SSH:
  ssh user@192.168.1.40
  notepad H:\\tech\\v4\\master-pc-test-kit\\tally-mcp\\.env
Or PowerShell one-liners:
  powershell -Command "Get-Content 'H:\\...\\.env' -Tail 5"
  powershell -Command "Add-Content -Path 'H:\\...\\.env' -Value 'KEY=value'"
  powershell -Command "(Get-Item 'H:\\...\\server.mjs').LastWriteTime = Get-Date"
"""
from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("pip install paramiko", file=sys.stderr)
    sys.exit(2)

REPO_ROOT = Path(__file__).resolve().parent.parent
LOCAL_DIST = REPO_ROOT / "dist"
LOCAL_PULL = REPO_ROOT / "pull"
LOCAL_TEST_PS1 = REPO_ROOT / "master-pc-test-kit" / "Test-Local.ps1"
LOCAL_PROBE = REPO_ROOT / "master-pc-test-kit" / "tally-mcp" / "scripts" / "probe-list-master.mjs"

HOST = os.environ.get("EMILDA_MASTER_SSH_HOST", "192.168.1.40")
USER = os.environ.get("EMILDA_MASTER_SSH_USER", "user")
PASSWORD = os.environ.get("EMILDA_MASTER_SSH_PASSWORD", "")
KIT_OVERRIDE = os.environ.get("EMILDA_MASTER_KIT", "").strip().rstrip("\\/")


def sftp_path(win_path: str) -> str:
    return win_path.replace("\\", "/")


def run_ps_encoded(client: paramiko.SSHClient, script: str, timeout: int = 120) -> str:
    enc = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    cmd = f"powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand {enc}"
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if err:
        print("stderr:", err, file=sys.stderr)
    return out


def discover_kit(client: paramiko.SSHClient) -> str:
    """Pick master-pc-test-kit path with newest tally-mcp\\dist\\server.mjs (prefers v4,v3,v2 then scans H:\\tech)."""
    ps = r"""
$best = ''
$t = [DateTime]::MinValue
foreach ($x in @('v4','v3','v2','v1','v5','v6')) {
  $p = Join-Path (Join-Path 'H:\tech' $x) 'master-pc-test-kit'
  $f = Join-Path $p 'tally-mcp\dist\server.mjs'
  if (Test-Path -LiteralPath $f) {
    $ft = (Get-Item -LiteralPath $f).LastWriteTimeUtc
    if ($ft -gt $t) { $t = $ft; $best = $p }
  }
}
if (-not $best -and (Test-Path 'H:\tech')) {
  Get-ChildItem -Path 'H:\tech' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Join-Path $_.FullName 'master-pc-test-kit'
    $f = Join-Path $p 'tally-mcp\dist\server.mjs'
    if (Test-Path -LiteralPath $f) {
      $ft = (Get-Item -LiteralPath $f).LastWriteTimeUtc
      if ($ft -gt $t) { $t = $ft; $best = $p }
    }
  }
}
Write-Output ('KIT_PATH=' + $best)
Write-Output ('TS_UTC=' + $t.ToString('o'))
"""
    out = run_ps_encoded(client, ps, timeout=60)
    kit = ""
    for ln in out.splitlines():
        ln = ln.strip()
        if ln.startswith("KIT_PATH="):
            kit = ln[len("KIT_PATH=") :].strip()
        elif ln.startswith("TS_UTC="):
            print(f"  (newest server.mjs: {ln})")
    return kit


def remote_touch_mtime(client: paramiko.SSHClient, paths: list[str]) -> None:
    """Bump LastWriteTime to now on each path (Windows equivalent of touch)."""
    stmts: list[str] = []
    for raw in paths:
        p = raw.strip()
        if not p:
            continue
        pesc = p.replace("'", "''")
        stmts.append(
            f"if (Test-Path -LiteralPath '{pesc}') {{ "
            f"(Get-Item -LiteralPath '{pesc}').LastWriteTime = Get-Date "
            f"}} else {{ Write-Output ('TOUCH_MISSING=' + '{pesc}') }}"
        )
    if not stmts:
        return
    ps = "\n".join(stmts) + "\nWrite-Output 'TOUCH_DONE'"
    print("--- Remote touch (PowerShell LastWriteTime) ---")
    out = run_ps_encoded(client, ps, timeout=90)
    for ln in out.splitlines():
        ln = ln.strip()
        if ln.startswith("TOUCH_MISSING="):
            print(" ", ln, file=sys.stderr)
        elif ln:
            print(" ", ln)


def restart_mcp(client: paramiko.SSHClient, kit_bs: str) -> None:
    """Stop node processes running tally-mcp server.mjs; start one for this kit."""
    # Escape single quotes for PowerShell single-quoted string
    k = kit_bs.replace("'", "''")
    ps = f"""
$kit = '{k}'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {{
  $cl = $_.CommandLine
  if ($null -eq $cl) {{ return }}
  if ($cl -match 'server\\.mjs' -and $cl -match 'tally-mcp') {{
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Output ('KILLED_PID=' + $_.ProcessId)
  }}
}}
Start-Sleep -Seconds 2
$dir = Join-Path $kit 'tally-mcp'
if (-not (Test-Path -LiteralPath (Join-Path $dir 'dist\\server.mjs'))) {{
  Write-Output 'START_SKIPPED_NO_SERVER_MJS'
  exit 0
}}
$p = Start-Process -FilePath 'node.exe' -ArgumentList 'dist\\server.mjs' -WorkingDirectory $dir -WindowStyle Hidden -PassThru
Write-Output ('STARTED_PID=' + $p.Id)
"""
    print("--- Restart MCP ---")
    out = run_ps_encoded(client, ps, timeout=90)
    for ln in out.splitlines():
        print(" ", ln.strip())


def main() -> int:
    if not PASSWORD:
        print("Set EMILDA_MASTER_SSH_PASSWORD for this session.", file=sys.stderr)
        return 2
    dist_mjs = sorted(LOCAL_DIST.glob("*.mjs"))
    if not dist_mjs:
        print(f"No *.mjs in {LOCAL_DIST} — run: npx tsc -p tsconfig.json", file=sys.stderr)
        return 2
    if not LOCAL_TEST_PS1.is_file():
        print(f"Missing {LOCAL_TEST_PS1}", file=sys.stderr)
        return 2
    if not LOCAL_PROBE.is_file():
        print(f"Missing {LOCAL_PROBE}", file=sys.stderr)
        return 2

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
        print(
            f"SSH connect failed to {USER}@{HOST}: {e}\n"
            "Roadblock: this PC cannot reach the Master PC (wrong network, PC off, IP changed, or firewall).",
            file=sys.stderr,
        )
        return 3

    try:
        if KIT_OVERRIDE:
            kit_bs = KIT_OVERRIDE if "\\" in KIT_OVERRIDE else KIT_OVERRIDE.replace("/", "\\")
            print(f"Using EMILDA_MASTER_KIT (override): {kit_bs}")
        else:
            print("Discovering newest master-pc-test-kit under H:\\tech ...")
            discovered = discover_kit(client)
            if not discovered:
                kit_bs = r"H:\tech\v2\master-pc-test-kit"
                print(f"Discovery returned empty — fallback: {kit_bs}")
            else:
                kit_bs = discovered if "\\" in discovered else discovered.replace("/", "\\")
                print(f"Selected kit: {kit_bs}")

        remote_dist_dir = sftp_path(f"{kit_bs}\\tally-mcp\\dist")
        remote_pull_dir = sftp_path(f"{kit_bs}\\tally-mcp\\pull")
        remote_ps1_sftp = sftp_path(f"{kit_bs}\\Test-Local.ps1")
        remote_probe_sftp = sftp_path(f"{kit_bs}\\tally-mcp\\scripts\\probe-list-master.mjs")
        remote_bat_sftp = sftp_path(f"{kit_bs}\\start-mcp-server.bat")

        mkdir_scripts = (
            f'cmd /c if not exist "{kit_bs}\\tally-mcp\\scripts" mkdir "{kit_bs}\\tally-mcp\\scripts" '
            f'& if not exist "{kit_bs}\\tally-mcp\\dist" mkdir "{kit_bs}\\tally-mcp\\dist" '
            f'& if not exist "{kit_bs}\\tally-mcp\\pull" mkdir "{kit_bs}\\tally-mcp\\pull"'
        )
        _, mo, me = client.exec_command(mkdir_scripts, timeout=30)
        mo.channel.recv_exit_status()
        mo.read()
        me.read()

        sftp = client.open_sftp()
        try:
            for m in dist_mjs:
                dest = f"{remote_dist_dir}/{m.name}"
                print("SFTP:", m, "->", dest)
                sftp.put(str(m), dest)
            if LOCAL_PULL.is_dir():
                for p in sorted(LOCAL_PULL.glob("*")):
                    if p.is_file() and not p.name.startswith("_"):
                        dest = f"{remote_pull_dir}/{p.name}"
                        print("SFTP:", p, "->", dest)
                        sftp.put(str(p), dest)
            print("SFTP:", LOCAL_TEST_PS1, "->", remote_ps1_sftp)
            sftp.put(str(LOCAL_TEST_PS1), remote_ps1_sftp)
            print("SFTP:", LOCAL_PROBE, "->", remote_probe_sftp)
            sftp.put(str(LOCAL_PROBE), remote_probe_sftp)

            bat_body = (
                "@echo off\r\n"
                f'cd /d "{kit_bs}\\tally-mcp"\r\n'
                "echo Starting MCP Server on port 3000...\r\n"
                "node dist/server.mjs\r\n"
            )
            print("SFTP: start-mcp-server.bat ->", remote_bat_sftp)
            with sftp.open(remote_bat_sftp, "w") as bf:
                bf.write(bat_body)
        finally:
            sftp.close()

        if os.environ.get("EMILDA_SKIP_TOUCH", "").strip() not in ("1", "true", "yes"):
            touch_list: list[str] = [
                f"{kit_bs}\\tally-mcp\\dist\\{m.name}" for m in dist_mjs
            ]
            touch_list.append(f"{kit_bs}\\start-mcp-server.bat")
            extra = os.environ.get("EMILDA_TOUCH_PATHS", "")
            for part in extra.split(";"):
                part = part.strip().strip('"')
                if part:
                    touch_list.append(part if "\\" in part or ":" in part else part.replace("/", "\\"))
            remote_touch_mtime(client, touch_list)
        else:
            print("EMILDA_SKIP_TOUCH set — skipped remote touch.")

        verify = (
            f'cmd /c findstr /c:"IMPORTANT for collection=company" "{kit_bs}\\tally-mcp\\dist\\mcp.mjs" '
            f">nul && echo VERIFY_MCP_TOOLDESC_OK || echo VERIFY_MCP_TOOLDESC_FAIL"
        )
        _, out, _ = client.exec_command(verify, timeout=30)
        print(out.read().decode("utf-8", errors="replace").strip())

        ps = (
            f'powershell.exe -NoProfile -ExecutionPolicy Bypass '
            f'-File "{kit_bs}\\Test-Local.ps1" -NonInteractive'
        )
        print("RUN:", ps)
        _, stdout, stderr = client.exec_command(ps, timeout=120)
        so = stdout.read().decode("utf-8", errors="replace")
        se = stderr.read().decode("utf-8", errors="replace")
        if so.strip():
            print(so.rstrip())
        if se.strip():
            print("stderr:", se.rstrip(), file=sys.stderr)

        if os.environ.get("EMILDA_SKIP_RESTART", "").strip() in ("1", "true", "yes"):
            print("EMILDA_SKIP_RESTART set — not restarting MCP.")
        else:
            restart_mcp(client, kit_bs)

        if os.environ.get("EMILDA_SKIP_PROBE", "").strip() not in ("1", "true", "yes"):
            probe_cmd = (
                f'cmd /c "cd /d "{kit_bs}\\tally-mcp" && node scripts\\probe-list-master.mjs"'
            )
            print("RUN:", probe_cmd)
            _, pout, perr = client.exec_command(probe_cmd, timeout=180)
            po = pout.read().decode("utf-8", errors="replace")
            pe = perr.read().decode("utf-8", errors="replace")
            if po.strip():
                print("--- probe stdout ---")
                print(po.rstrip())
            if pe.strip():
                print("--- probe stderr ---", file=sys.stderr)
                print(pe.rstrip(), file=sys.stderr)
        else:
            print("EMILDA_SKIP_PROBE set — skipped probe.")
    finally:
        client.close()

    print("\n=== Deploy + restart complete ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
