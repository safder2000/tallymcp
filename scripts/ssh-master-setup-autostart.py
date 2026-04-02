"""SSH into Master PC: discover Tally, check startup, test MCP, create auto-start."""
import os, sys
try:
    import paramiko
except ImportError:
    print("pip install paramiko", file=sys.stderr); sys.exit(2)

HOST = os.environ.get("EMILDA_MASTER_SSH_HOST", "192.168.1.40")
USER = os.environ.get("EMILDA_MASTER_SSH_USER", "user")
PASSWORD = os.environ.get("EMILDA_MASTER_SSH_PASSWORD", "")
KIT = os.environ.get("EMILDA_MASTER_KIT", "H:\\tech\\v2\\master-pc-test-kit")

if not PASSWORD:
    print("Set EMILDA_MASTER_SSH_PASSWORD", file=sys.stderr); sys.exit(2)

def run(client, cmd, timeout=30):
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return out, err

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
except (TimeoutError, OSError) as e:
    print(f"SSH connect failed: {e}", file=sys.stderr); sys.exit(3)

try:
    print("=== 1. Finding Tally (running process) ===")
    out, _ = run(client, 'powershell -NoProfile -Command "Get-Process | Where-Object {$_.Name -like ''*tally*''} | Select-Object Name,Id,Path | Format-List"')
    print(out or "  No Tally process running")
    print()

    print("=== 2. Finding Tally (known paths) ===")
    paths = [
        "C:\\TallyPrime\\tally.exe",
        "C:\\Tally\\TallyPrime\\tally.exe",
        "C:\\Program Files\\TallyPrime\\tally.exe",
        "C:\\Program Files (x86)\\TallyPrime\\tally.exe",
        "D:\\TallyPrime\\tally.exe",
        "D:\\Tally\\TallyPrime\\tally.exe",
        "G:\\TallyPrime\\tally.exe",
        "H:\\TallyPrime\\tally.exe",
        "C:\\Tally.ERP9\\tally.exe",
    ]
    check = " ".join([f'if exist "{p}" echo FOUND:{p}' for p in paths])
    out, _ = run(client, f'cmd /c "{check}"')
    print(out or "  Not in common paths")
    print()

    print("=== 3. Finding Tally (desktop/start menu shortcuts) ===")
    out, _ = run(client, 'cmd /c "dir /s /b C:\\Users\\user\\Desktop\\*.lnk 2>nul"')
    if out:
        for line in out.split("\n"):
            if "tally" in line.lower():
                print(f"  DESKTOP: {line}")
    out, _ = run(client, 'cmd /c "dir /s /b C:\\Users\\Public\\Desktop\\*.lnk 2>nul"')
    if out:
        for line in out.split("\n"):
            if "tally" in line.lower():
                print(f"  PUBLIC DESKTOP: {line}")
    print()

    print("=== 4. Finding Tally (registry) ===")
    out, _ = run(client, 'cmd /c "reg query HKLM\\SOFTWARE\\WOW6432Node /s /f tally /k 2>nul | findstr /i tally"', timeout=15)
    print(out[:800] if out else "  Not in WOW6432Node")
    out, _ = run(client, 'cmd /c "reg query HKLM\\SOFTWARE /s /f TallyPrime /k /t REG_SZ 2>nul | findstr /i tally"', timeout=15)
    print(out[:800] if out else "  Not in HKLM\\SOFTWARE")
    print()

    print("=== 5. Processes & ports ===")
    out, _ = run(client, 'powershell -NoProfile -Command "Get-Process node,tally* -ErrorAction SilentlyContinue | Select-Object Name,Id,Path | Format-Table -AutoSize"')
    print(out or "  No node/tally processes")
    out, _ = run(client, 'cmd /c "netstat -ano | findstr LISTEN | findstr /r \":9000 :3000\""')
    print(f"  Ports: {out or 'neither 9000 nor 3000 listening'}")
    print()

    print("=== 6. Startup folder ===")
    out, _ = run(client, 'cmd /c "dir /b C:\\Users\\user\\AppData\\Roaming\\Microsoft\\Windows\\\"Start Menu\"\\Programs\\Startup 2>nul"')
    print(f"  {out or '(empty)'}")
    print()

    print("=== 7. Cloudflared ===")
    out, _ = run(client, 'powershell -NoProfile -Command "Get-Service *cloudflare* -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType | Format-Table"')
    print(f"  {out or '(not a Windows service)'}")
    out, _ = run(client, 'cmd /c "where cloudflared 2>nul"')
    print(f"  Path: {out or '(not in PATH)'}")
    print()

    print("=== 8. MCP probe ===")
    out, err = run(client, f'cmd /c "cd /d {KIT}\\tally-mcp && node scripts\\probe-list-master.mjs"', timeout=30)
    print(f"  {out}")
    if err:
        print(f"  stderr: {err}")

finally:
    client.close()
