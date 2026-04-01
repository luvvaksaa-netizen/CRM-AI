#!/bin/bash
# ============================================================
# CRM-AI AUTO-DEPLOY SCRIPT
# ============================================================

echo "🚀 Memulai proses update aplikasi..."

# 1. Tarik perubahan terbaru dari GitHub
git pull origin main

# 2. Update library (jika ada tambahan)
npm install

# 3. Restart bot di background menggunakan PM2
pm2 restart whatsapp-ai

echo "✅ UPDATE BERHASIL! Bot AI sudah versi terbaru."
pm2 list
