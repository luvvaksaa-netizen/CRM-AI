#!/bin/bash
# VPS Setup Script for CRM-AI
# Usage: bash vps_setup.sh <OPENAI_KEY> <RAJAONGKIR_KEY> <RAJAONGKIR_TYPE>

set -e

OPENAI_KEY=$1
RAJAONGKIR_KEY=$2
RAJAONGKIR_TYPE=$3

echo "🚀 [1/8] Updating System & Installing Node.js 20..."
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

echo "📦 [2/8] Installing Chromium dependencies for WhatsApp..."
sudo apt install -y gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget libgbm-dev

echo "⚙️ [3/8] Installing Global Tools (PM2)..."
sudo npm install -g pm2

echo "📥 [4/8] Cloning Repository..."
cd /root
rm -rf CRM-AI
git clone https://github.com/luvvaksaa-netizen/CRM-AI.git
cd CRM-AI

echo "📚 [5/8] Installing NPM Packages..."
npm install

echo "📝 [6/8] Creating Environment File (.env)..."
cat <<EOF > .env
PORT=3000
OPENAI_API_KEY=$OPENAI_KEY
RAJAONGKIR_API_KEY=$RAJAONGKIR_KEY
RAJAONGKIR_ACCOUNT_TYPE=$RAJAONGKIR_TYPE
ADMIN_USER=admin
ADMIN_PASS=admin123
DATABASE_URL=sqlite:./database.sqlite
EOF

echo "🔥 [7/8] Starting Application with PM2..."
pm2 start index.js --name "wa-ai-crm"
pm2 save
pm2 startup

echo "🛡️ [8/8] Configuring Firewall (Port 3000)..."
sudo ufw allow 3000/tcp
sudo ufw --force enable

echo "✅ DEPLOYMENT SUCCESSFUL!"
echo "--------------------------------------------------"
echo "Dashboard is ready at: http://$(curl -s ifconfig.me):3000"
echo "--------------------------------------------------"
