"""
Read-only SSH probe for Master PC (Windows OpenSSH).
Usage: set EMILDA_MASTER_SSH_PASSWORD then run this script.
Does not print the password.
"""
import os
import sys

try:
    import paramiko
except ImportError:
    print("Install: pip install paramiko", file=sys.stderr)
    sys.exit(2)

HOST = os.environ.get("EMILDA_MASTER_SSH_HOST", "192.168.1.40")
USER = os.environ.get("EMILDA_MASTER_SSH_USER", "user")
PASSWORD = os.environ.get("EMILDA_MASTER_SSH_PASSWORD", "")

if not PASSWORD:
    print("Set EMILDA_MASTER_SSH_PASSWORD (one-shot) and re-run.", file=sys.stderr)
    sys.exit(2)

# Windows OpenSSH: run via cmd for H: paths
COMMANDS = [
    ("info", "cmd /c echo HOST=%COMPUTERNAME% USER=%USERNAME%"),
    ("node_version", "cmd /c node -v"),
    ("dir_kit", 'cmd /c dir /b "H:\\tech\\v2\\master-pc-test-kit"'),
    ("dir_tally_mcp", 'cmd /c dir /b "H:\\tech\\v2\\master-pc-test-kit\\tally-mcp" 2>&1'),
    ("node_modules", 'cmd /c if exist "H:\\tech\\v2\\master-pc-test-kit\\tally-mcp\\node_modules\\@modelcontextprotocol" (echo MCP_SDK_PRESENT) else (echo MCP_SDK_MISSING)'),
    ("tally_mjs_has_findDataNode", 'cmd /c findstr /c:"findDataNode" "H:\\tech\\v2\\master-pc-test-kit\\tally-mcp\\dist\\tally.mjs" >nul && echo FINDDATANODE_YES || echo FINDDATANODE_NO'),
    ("tally_mjs_head", 'powershell -NoProfile -Command "Get-Content -LiteralPath ''H:\\tech\\v2\\master-pc-test-kit\\tally-mcp\\dist\\tally.mjs'' -TotalCount 25 -ErrorAction SilentlyContinue"'),
]


def main() -> None:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST,
        username=USER,
        password=PASSWORD,
        timeout=20,
        allow_agent=False,
        look_for_keys=False,
    )
    try:
        for label, cmd in COMMANDS:
            print(f"=== {label} ===")
            stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
            out = stdout.read().decode("utf-8", errors="replace").strip()
            err = stderr.read().decode("utf-8", errors="replace").strip()
            if out:
                print(out)
            if err:
                print("stderr:", err)
            print()
    finally:
        client.close()


if __name__ == "__main__":
    main()
