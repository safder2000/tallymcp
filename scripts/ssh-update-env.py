"""Upload updated .env to Master PC tally-mcp folder."""
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
    return (
        stdout.read().decode("utf-8", errors="replace").strip(),
        stderr.read().decode("utf-8", errors="replace").strip(),
    )

ENV_CONTENT = """\
PASSWORD=password
MCP_DOMAIN=https://tally.kmctnucleus.com
CONNECTION_STRING=
TALLY_DEFAULT_COMPANY=KMCT Polytechnic College-(2021-22) - (from 1-Apr-21)
TALLY_SVUSERNAME=admin
TALLY_SVPASSWORD=KOMATH8888
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
try:
    sftp = client.open_sftp()
    env_remote = f"{KIT}/tally-mcp/.env".replace("\\", "/")
    print(f"Uploading .env to {env_remote}")
    with sftp.open(env_remote, "w") as f:
        f.write(ENV_CONTENT)
    sftp.close()

    # Verify
    out, _ = run(client, f'powershell -NoProfile -Command "Get-Content \'{env_remote}\'"')
    print(f"\nNew .env:\n{out}")
finally:
    client.close()
