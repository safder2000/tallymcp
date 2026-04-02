"""Remove the extra .bat from startup folder (VBS handles it)."""
import os, sys
try:
    import paramiko
except ImportError:
    print("pip install paramiko", file=sys.stderr); sys.exit(2)

HOST = os.environ.get("EMILDA_MASTER_SSH_HOST", "192.168.1.40")
USER = os.environ.get("EMILDA_MASTER_SSH_USER", "user")
PASSWORD = os.environ.get("EMILDA_MASTER_SSH_PASSWORD", "")
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
client.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
try:
    # Remove the .bat from startup (only VBS should be there)
    bat_in_startup = f'{STARTUP}/start-mcp-server.bat'
    out, err = run(client, f'powershell -NoProfile -Command "Remove-Item \'{bat_in_startup}\' -ErrorAction SilentlyContinue; echo done"')
    print(f"Removed .bat from startup: {out}")

    # Also update .env with MCP_DOMAIN
    KIT = os.environ.get("EMILDA_MASTER_KIT", "H:\\tech\\v2\\master-pc-test-kit")
    env_path = f'{KIT}/tally-mcp/.env'.replace("\\", "/")
    out, _ = run(client, f'powershell -NoProfile -Command "Get-Content \'{env_path}\'"')
    print(f"\nCurrent .env:\n{out}")

    # Final startup folder listing
    print("\n=== Final startup folder ===")
    out, _ = run(client, f'powershell -NoProfile -Command "Get-ChildItem \'{STARTUP}\' | Select-Object Name"')
    print(out)
finally:
    client.close()
