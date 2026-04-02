"""
Create startup scripts on Master PC for:
1. TallyPrime (auto-launch on login)
2. MCP Server (node dist/server.mjs)

Cloudflared is already a Windows service (Automatic) - no action needed.
"""
import os, sys
try:
    import paramiko
except ImportError:
    print("pip install paramiko", file=sys.stderr); sys.exit(2)

HOST = os.environ.get("EMILDA_MASTER_SSH_HOST", "192.168.1.40")
USER = os.environ.get("EMILDA_MASTER_SSH_USER", "user")
PASSWORD = os.environ.get("EMILDA_MASTER_SSH_PASSWORD", "")
KIT = os.environ.get("EMILDA_MASTER_KIT", "H:\\tech\\v2\\master-pc-test-kit")

TALLY_EXE = "C:\\Program Files\\TallyPrime\\tally.exe"
STARTUP_FOLDER = 'C:\\Users\\user\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup'

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
    # 1. Create MCP startup batch file
    print("=== Creating MCP startup batch ===")
    mcp_bat = f"{KIT}\\start-mcp-server.bat"
    mcp_bat_content = (
        '@echo off\\r\\n'
        f'cd /d "{KIT}\\\\tally-mcp"\\r\\n'
        'echo Starting MCP Server...\\r\\n'
        'node dist/server.mjs\\r\\n'
    )
    # Write bat file
    cmd = f'cmd /c "echo @echo off>{mcp_bat} && echo cd /d {KIT}\\tally-mcp>>{mcp_bat} && echo echo Starting MCP Server...>>{mcp_bat} && echo node dist/server.mjs>>{mcp_bat}"'
    out, err = run(client, cmd)
    if err:
        print(f"  Error writing bat: {err}")
    else:
        print(f"  Created: {mcp_bat}")

    # Verify
    out, _ = run(client, f'cmd /c "type {mcp_bat}"')
    print(f"  Contents:\n{out}\n")

    # 2. Create VBS launcher for MCP (runs hidden, no cmd window)
    print("=== Creating MCP hidden launcher (VBS) ===")
    mcp_vbs = f'{STARTUP_FOLDER}\\start-mcp-server.vbs'
    # Use powershell to write the VBS to avoid echo escaping issues
    vbs_content = f'Set WshShell = CreateObject("WScript.Shell")\\nWshShell.Run """{mcp_bat}""", 0, False'
    ps_write_vbs = (
        f'powershell -NoProfile -Command "'
        f"$c = 'Set WshShell = CreateObject(\"\"WScript.Shell\"\")' + [char]13 + [char]10 + "
        f"'WshShell.Run \"\"\"\"\"\"\" & \\\"{mcp_bat}\\\" & \"\"\"\"\"\"\", 0, False';"
        f"$c | Out-File -FilePath '{mcp_vbs}' -Encoding ascii -Force"
        f'"'
    )
    # Simpler approach: write via cmd echo
    vbs_line1 = 'Set WshShell = CreateObject("WScript.Shell")'
    vbs_line2 = f'WshShell.Run """{mcp_bat}""", 0, False'
    
    # Use powershell Set-Content which is more reliable
    ps_cmd = (
        f'powershell -NoProfile -Command "'
        f"@('"
        f'Set WshShell = CreateObject(\\\"WScript.Shell\\\")'
        f"','"
        f'WshShell.Run \\\"\\\"\\\"{mcp_bat}\\\"\\\"\\\", 0, False'
        f"') | Set-Content -Path '{mcp_vbs}' -Force"
        f'"'
    )
    out, err = run(client, ps_cmd)
    if err:
        print(f"  VBS write issue: {err}")

    out, _ = run(client, f'cmd /c "type \\"{mcp_vbs}\\""')
    if out:
        print(f"  VBS contents:\n{out}\n")
    else:
        print("  VBS write may have failed, trying simpler approach...")
        # Fallback: just put a .bat shortcut in startup
        simple_bat = f'{STARTUP_FOLDER}\\start-mcp-server.bat'
        cmd2 = (
            f'cmd /c "'
            f'echo @echo off>"{simple_bat}" && '
            f'echo cd /d {KIT}\\tally-mcp>>"{simple_bat}" && '
            f'echo start /min node dist/server.mjs>>"{simple_bat}"'
            f'"'
        )
        out, err = run(client, cmd2)
        out, _ = run(client, f'cmd /c "type \\"{simple_bat}\\""')
        print(f"  Startup bat contents:\n{out}\n")

    # 3. Create TallyPrime shortcut in startup
    print("=== Creating TallyPrime startup shortcut ===")
    tally_lnk = f'{STARTUP_FOLDER}\\TallyPrime.lnk'
    ps_shortcut = (
        f'powershell -NoProfile -Command "'
        f"$ws = New-Object -ComObject WScript.Shell; "
        f"$sc = $ws.CreateShortcut('{tally_lnk}'); "
        f"$sc.TargetPath = '{TALLY_EXE}'; "
        f"$sc.WorkingDirectory = 'C:\\Program Files\\TallyPrime'; "
        f"$sc.Save()"
        f'"'
    )
    out, err = run(client, ps_shortcut)
    if err:
        print(f"  Shortcut error: {err}")
    else:
        print(f"  Created: {tally_lnk}")

    # 4. Verify startup folder
    print("\n=== Startup folder now ===")
    out, _ = run(client, f'cmd /c "dir /b \\"{STARTUP_FOLDER}\\""')
    print(f"  {out}")

finally:
    client.close()
