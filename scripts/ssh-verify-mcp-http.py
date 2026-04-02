"""SSH: curl http://127.0.0.1:3000/ on Master and show node.exe lines from tasklist."""
import os
import sys

import paramiko

HOST = os.environ.get("EMILDA_MASTER_SSH_HOST", "192.168.1.40")
USER = os.environ.get("EMILDA_MASTER_SSH_USER", "user")
PASSWORD = os.environ.get("EMILDA_MASTER_SSH_PASSWORD", "")

if __name__ == "__main__":
    if not PASSWORD:
        sys.exit("Set EMILDA_MASTER_SSH_PASSWORD")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    try:
        _, o, _ = c.exec_command(
            "curl -s -o NUL -w %{http_code} http://127.0.0.1:3000/", timeout=15
        )
        print("HTTP", o.read().decode().strip())
        _, o2, _ = c.exec_command('cmd /c tasklist /FI "IMAGENAME eq node.exe"', timeout=15)
        print(o2.read().decode())
    finally:
        c.close()
