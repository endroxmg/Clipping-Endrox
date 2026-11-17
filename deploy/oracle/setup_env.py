"""Create the private Docker configuration for an Oracle Always Free VM."""
import ipaddress
import secrets
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 deploy/oracle/setup_env.py PUBLIC_IPV4")
try:
    address = ipaddress.IPv4Address(sys.argv[1])
except ipaddress.AddressValueError as error:
    raise SystemExit(f"Enter the VM's public IPv4 address: {error}") from error
if not address.is_global:
    raise SystemExit("Enter a public IPv4 address assigned to your VM.")

config = Path(".env")
if config.exists():
    raise SystemExit(".env already exists. Its settings were left untouched.")

hostname = f"{str(address).replace('.', '-')}.sslip.io"
config.write_text(
    f"PEAKCUT_DOMAIN={hostname}\n"
    f"POSTGRES_PASSWORD={secrets.token_hex(32)}\n"
    "COMPOSE_PROFILES=own-https\n"
    "PEAKCUT_TRUST_PROXY=1\n"
    "PEAKCUT_JOB_WORKERS=1\n"
    "PEAKCUT_MAX_LIVE=1\n"
    "PEAKCUT_UPDATE_CHECK=0\n"
    "PEAKCUT_REPO_URL=https://github.com/endroxmg/Clipping-Endrox\n"
)
config.chmod(0o600)
print(f"Private configuration saved. Your future Endrox address is https://{hostname}")
