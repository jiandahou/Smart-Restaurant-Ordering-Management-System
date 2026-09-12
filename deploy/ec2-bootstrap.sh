#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# DineFlow EC2 bootstrap — run ONCE on a fresh Ubuntu 22.04/24.04 instance.
# Installs Docker + Compose plugin and prepares the app directory.
#
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/ec2-bootstrap.sh | bash
#   (or scp this file up and: bash ec2-bootstrap.sh)
# ---------------------------------------------------------------------------
set -euo pipefail

echo "==> Updating apt and installing prerequisites"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git gnupg

echo "==> Installing Docker Engine + Compose plugin (official repo)"
sudo install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
fi
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "==> Adding '$USER' to the docker group (re-login required to take effect)"
sudo usermod -aG docker "$USER" || true

echo "==> Enabling Docker on boot"
sudo systemctl enable --now docker

echo "==> Ensuring a 2G swap file (protects small instances during image builds)"
if ! sudo swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  echo "   swap enabled"
else
  echo "   swap already present"
fi

echo ""
echo "Docker version: $(sudo docker --version)"
echo "Compose version: $(sudo docker compose version)"
echo ""
echo "==> Next steps:"
cat <<'EOF'
  1. git clone <your repo>  "Smart Restaurant Ordering System"
     cd "Smart Restaurant Ordering System"
  2. cp .env.prod.example .env.prod   && edit real secrets
  3. Copy your Cloudflare tunnel credentials JSON to:
        deploy/cloudflared/16f95d76-7fd8-4604-be21-ba71e2bfe302.json
  4. Log out and back in (so 'docker' works without sudo), then:
        docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
  5. Watch it come up:
        docker compose -f docker-compose.prod.yml logs -f backend cloudflared
EOF
