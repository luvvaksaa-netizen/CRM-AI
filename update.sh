#!/bin/bash
# ============================================================
# CRM-AI AUTO-DEPLOY SCRIPT
# ============================================================

set -euo pipefail

echo "Memulai proses update aplikasi..."

# 1. Backup current state before pulling
STASH_NEEDED=false
if ! git diff --quiet; then
    STASH_NEEDED=true
    echo "Menyimpan perubahan lokal sementara..."
    git stash push -m "auto-stash before update $(date +%Y%m%d-%H%M%S)"
fi

# 2. Tarik perubahan terbaru dari GitHub
git pull origin main

# 3. Kembalikan stash jika ada
if [ "$STASH_NEEDED" = true ]; then
    git stash pop || echo "Tidak ada stash untuk dikembalikan"
fi

# 4. Update library (jika ada tambahan)
npm install

# 5. Restart bot di background menggunakan PM2
if pm2 describe wa-crm > /dev/null 2>&1; then
    pm2 restart wa-crm
else
    pm2 start index.js --name wa-crm
fi

echo "UPDATE BERHASIL! Bot AI sudah versi terbaru."
pm2 list
