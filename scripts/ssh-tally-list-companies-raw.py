"""
SSH to Master PC: POST list-of-companies.xml to Tally :9000, print COMPANY names / raw snippet.
Requires: pip install paramiko, EMILDA_MASTER_SSH_PASSWORD
"""
from __future__ import annotations

import base64
import os
import re
import sys

try:
    import paramiko
except ImportError:
    print("pip install paramiko", file=sys.stderr)
    sys.exit(2)

HOST = os.environ.get("EMILDA_MASTER_SSH_HOST", "192.168.1.40")
USER = os.environ.get("EMILDA_MASTER_SSH_USER", "user")
PASSWORD = os.environ.get("EMILDA_MASTER_SSH_PASSWORD", "")
XML_PATH = os.environ.get("EMILDA_TALLY_LIST_XML", r"H:\tech\tallymcp\pull\list-of-companies.xml")

PS = rf"""
$ErrorActionPreference = 'Stop'
$p = '{XML_PATH.replace(chr(39), chr(39)+chr(39))}'
$xml = Get-Content -LiteralPath $p -Raw -Encoding UTF8
$u = 'http://127.0.0.1:9000/'
try {{
  $r = Invoke-WebRequest -Uri $u -Method POST -Body $xml -ContentType 'application/xml' -TimeoutSec 60 -UseBasicParsing
  $t = $r.Content
  Write-Host 'HTTP_STATUS' $r.StatusCode
  Write-Host 'CONTENT_LENGTH' $t.Length
  $names = [regex]::Matches($t, '<COMPANY\b[^>]*\bNAME="([^"]*)"', 'IgnoreCase')
  Write-Host 'COMPANY_NAME_ATTR_COUNT' $names.Count
  foreach ($m in $names) {{ Write-Host 'COMPANY:' $m.Groups[1].Value }}
  Write-Host '--- RAW FIRST 3500 ---'
  Write-Host $t.Substring(0, [Math]::Min(3500, $t.Length))
}} catch {{
  Write-Host 'ERR:' $_.Exception.Message
}}
"""


def main() -> None:
    if not PASSWORD:
        print("Set EMILDA_MASTER_SSH_PASSWORD", file=sys.stderr)
        sys.exit(2)
    enc = base64.b64encode(PS.encode("utf-16-le")).decode("ascii")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=25, allow_agent=False, look_for_keys=False)
    try:
        _, stdout, stderr = c.exec_command(
            f"powershell -NoProfile -EncodedCommand {enc}", timeout=90
        )
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        sys.stdout.write(out)
        if err.strip() and "CLIXML" not in err:
            sys.stderr.write(err)
    finally:
        c.close()


if __name__ == "__main__":
    main()
