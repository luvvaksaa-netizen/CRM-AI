#!/bin/bash
# ============================================================
# V2-Core VPS Deployment Script
# Run from project root: bash deploy-vps.sh
# ============================================================
set -euo pipefail

APP_DIR="/opt/crm-ai-fresh"
LOGS_DIR="${APP_DIR}/logs"

echo "╔══════════════════════════════════════════╗"
echo "║    V2-Core VPS Deploy Script            ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── Step 0: Navigate to app dir ─────────────────────────
cd "${APP_DIR}" || { echo "❌ ${APP_DIR} not found!"; exit 1; }
mkdir -p "${LOGS_DIR}"

# ─── Step 1: Pull latest code ────────────────────────────
echo "[1/6] Pull latest code from GitHub..."
git fetch origin
git reset --hard origin/main
echo "✅ Code updated"

# ─── Step 2: Install backend dependencies ─────────────────
echo ""
echo "[2/6] Install backend dependencies..."
cd v2-core/backend
npm install --no-audit --no-fund
cd ../..
echo "✅ Backend deps installed"

# ─── Step 3: Install frontend dependencies ────────────────
echo ""
echo "[3/6] Install frontend dependencies..."
cd v2-core/frontend
npm install --no-audit --no-fund
cd ../..
echo "✅ Frontend deps installed"

# ─── Step 4: Build backend (TypeScript) ──────────────────
echo ""
echo "[4/6] Build backend (TypeScript)..."
cd v2-core/backend
npx tsc
cd ../..
echo "✅ Backend built"

# ─── Step 5: Build frontend (Vite) ───────────────────────
echo ""
echo "[5/6] Build frontend (Vite)..."
cd v2-core/frontend
npx vite build
cd ../..
echo "✅ Frontend built"

# ─── Step 6: Kill orphan Chromium & restart PM2 ─────────
echo ""
echo "[6/6] Kill orphan Chromium & restart PM2..."
# Kill any orphan Chrome/Chromium processes
pkill -f "chrome" 2>/dev/null || true
pkill -f "chromium" 2>/dev/null || true
sleep 3

# Clean Chromium lock files
find "${APP_DIR}/v2-core/backend/.wwebjs_auth" -name "SingletonLock" -delete 2>/dev/null || true
find "${APP_DIR}/v2-core/backend/.wwebjs_auth" -name "SingletonCookie" -delete 2>/dev/null || true
find "${APP_DIR}/v2-core/backend/.wwebjs_auth" -name "SingletonSocket" -delete 2>/dev/null || true

# Restart PM2
export PM2_HOME="/root/.pm2"
pm2 daemon 2>/dev/null || true
pm2 delete v2-core-api 2>/dev/null || true
pm2 start "${APP_DIR}/ecosystem.vps.config.js"
pm2 save
echo "✅ PM2 restarted"

# ─── Done ────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║          DEPLOY SELESAI ✅               ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Cek status:"
echo "  pm2 status"
echo ""
echo "Cek logs:"
echo "  pm2 logs v2-core-api --lines 30"
echo ""
echo "Cek browser:"
echo "  Buka https://crm.datasdm.com"
echo ""
