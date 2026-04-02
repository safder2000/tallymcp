"""Fix MCP startup: upload a pre-built .bat and .vbs, then verify startup folder."""
import os, sys
try:
    import paramiko
except ImportError:
    print("pip install paramiko", file=sys.stderr); sys.exit(2)

HOST = os.environ.get("EMILDA_MASTER_SSH_HOST", "192.168.1.40")
USER = os.environ.get("EMILDA_MASTER_SSH_USER", "user")
PASSWORD = os.environ.get("EMILDA_MASTER_SSH_PASSWORD", "")
KIT = os.environ.get("EMILDA_MASTER_KIT", "H:\\tech\\v2\\master-pc-test-kit")
STARTUP = "C:/Users/user/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup"

if not PASSWORD:
    print("Set EMILDA_MASTER_SSH_PASSWORD", file=sys.stderr); sys.exit(2)

def run(client, cmd, timeout=30):
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    return (
        stdout.read().decode("utf-8", errors="replace").strip(),
        stderr.read().decode("utf-8", errors="replace").strip(),
    )

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
except (TimeoutError, OSError) as e:
    print(f"SSH connect failed: {e}", file=sys.stderr); sys.exit(3)

try:
    sftp = client.open_sftp()

    # 1. Upload start-mcp-server.bat to KIT folder
    bat_content = (
        f'@echo off\r\n'
        f'cd /d "{KIT}\\tally-mcp"\r\n'
        f'echo Starting MCP Server on port 3000...\r\n'
        f'node dist/server.mjs\r\n'
    )
    bat_remote = f"{KIT}/start-mcp-server.bat".replace("\\", "/")
    print(f"Uploading {bat_remote}")
    with sftp.open(bat_remote, "w") as f:
        f.write(bat_content)

    # 2. Upload VBS hidden launcher to Startup folder
    vbs_content = (
        f'Set WshShell = CreateObject("WScript.Shell")\r\n'
        f'WshShell.Run """' + KIT.replace("/", "\\") + '\\start-mcp-server.bat""", 0, False\r\n'
    )
    vbs_remote = f"{STARTUP}/start-mcp-server.vbs"
    print(f"Uploading {vbs_remote}")
    with sftp.open(vbs_remote, "w") as f:
        f.write(vbs_content)

    sftp.close()

    # 3. Verify
    print("\n=== Verify files ===")
    out, _ = run(client, f'cmd /c "type {KIT}\\start-mcp-server.bat"')
    print(f"BAT:\n{out}\n")

    out, _ = run(client, f'powershell -NoProfile -Command "Get-Content \'{STARTUP}/start-mcp-server.vbs\'"')
    print(f"VBS:\n{out}\n")

    # 4. List startup folder
    print("=== Startup folder ===")
    out, _ = run(client, f'powershell -NoProfile -Command "Get-ChildItem \'{STARTUP}\' | Select-Object Name"')
    print(out)

finally:
    client.close()
