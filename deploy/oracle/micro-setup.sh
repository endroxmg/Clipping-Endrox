#!/usr/bin/env bash
set -euo pipefail

# Run as ubuntu from the cloned repository: bash deploy/oracle/micro-setup.sh PUBLIC_IPV4
if [[ $# -ne 1 || ! $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: bash deploy/oracle/micro-setup.sh PUBLIC_IPV4" >&2
  exit 2
fi

hostname="${1//./-}.sslip.io"
if [[ ! -f /swapfile ]]; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  python3-venv python3-pip ffmpeg git caddy unzip iptables-persistent fonts-noto-core fonts-noto-cjk

for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
  fi
done
sudo netfilter-persistent save

if ! command -v deno >/dev/null 2>&1; then
  deno_archive="$(mktemp)"
  deno_version="$(curl -fsSL --max-time 20 https://dl.deno.land/release-latest.txt)"
  curl -fsSL --retry 3 --max-time 120 -o "$deno_archive" \
    "https://dl.deno.land/release/${deno_version}/deno-x86_64-unknown-linux-gnu.zip"
  sudo unzip -oq "$deno_archive" deno -d /usr/local/bin
  rm -f "$deno_archive"
fi

python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements-micro.txt

if [[ ! -f .env ]]; then
  setup_token="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
  cat > .env <<EOF
PEAKCUT_HOST=127.0.0.1
PEAKCUT_PUBLIC_URL=https://${hostname}
PEAKCUT_ACCOUNTS=1
PEAKCUT_SETUP_TOKEN=${setup_token}
PEAKCUT_TRUST_PROXY=1
PEAKCUT_LIGHT_MODE=1
PEAKCUT_FETCH_MODEL=0
PEAKCUT_REQUEST_THREADS=8
PEAKCUT_JOB_WORKERS=1
PEAKCUT_MIN_FREE_RAM_GB=0.15
PEAKCUT_BUSY_CPU=95
PEAKCUT_MAX_VIDEO_HOURS=1
PEAKCUT_MAX_LIVE_HOURS=1
PEAKCUT_MAX_LIVE=1
PEAKCUT_MAX_JOBS_PER_USER=1
PEAKCUT_MAX_USER_GB=5
PEAKCUT_MAX_UPLOAD_MB=500
PEAKCUT_YT_TRANSCRIPT=1
PEAKCUT_UPDATE_CHECK=0
PEAKCUT_REPO_URL=https://github.com/endroxmg/Clipping-Endrox
EOF
  chmod 600 .env
fi

repo="$(pwd)"
sudo tee /etc/systemd/system/endrox.service >/dev/null <<EOF
[Unit]
Description=Endrox clipping studio
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=${repo}
ExecStart=${repo}/.venv/bin/python -m studio.server
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
MemoryMax=850M

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
${hostname} {
    reverse_proxy 127.0.0.1:8765
}
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now endrox
sudo systemctl enable caddy
sudo systemctl restart caddy
echo "Endrox configured at https://${hostname}"
if grep -q '^PEAKCUT_SETUP_TOKEN=' .env; then
  echo "Create your owner account: https://${hostname}/signup?setup=$(sed -n 's/^PEAKCUT_SETUP_TOKEN=//p' .env)"
fi
