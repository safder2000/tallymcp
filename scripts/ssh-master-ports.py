import os, sys
import paramiko
p = os.environ.get("EMILDA_MASTER_SSH_PASSWORD", "")
if not p:
    sys.exit("Set EMILDA_MASTER_SSH_PASSWORD")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("192.168.1.40", username="user", password=p, timeout=15, allow_agent=False, look_for_keys=False)
for label, cmd in [
    ("tasklist", 'cmd /c tasklist /FI "IMAGENAME eq node.exe" /FI "IMAGENAME eq tally.exe"'),
    ("net3000", 'cmd /c netstat -ano | findstr ":3000"'),
    ("net9000", 'cmd /c netstat -ano | findstr ":9000"'),
]:
    _, o, e = c.exec_command(cmd, timeout=25)
    print("===", label, "===")
    print(o.read().decode(errors="replace").strip())
c.close()
