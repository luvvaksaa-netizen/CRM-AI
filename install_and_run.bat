@echo off
title Installer & Auto-Start CRM WhatsApp
color 0A

echo ===================================================
echo     AUTO-INSTALLER WA-AI CRM (PRODUCTION MODE)
echo ===================================================
echo.
echo Pastikan Node.js (v20+) sudah terinstall di laptop ini.
pause

echo.
echo [1/5] Menginstall Dependencies (NPM Install)...
call npm install --omit=dev

echo.
echo [2/5] Menginstall PM2 (Process Manager) secara global...
call npm install -g pm2

echo.
echo [3/5] Mengkonfigurasi Sertifikat Cloudflare Tunnel...
if not exist "%USERPROFILE%\.cloudflared" mkdir "%USERPROFILE%\.cloudflared"
copy /Y ".\.cloudflared_backup\*.*" "%USERPROFILE%\.cloudflared\"

echo.
echo [4/5] Menjalankan Server & Tunnel di Latar Belakang (PM2)...
call pm2 stop all
call pm2 delete all
call pm2 start index.js --name "wa-crm"
call pm2 start cloudflared.exe --name "cf-tunnel" -- tunnel run --url http://localhost:3000 crm-tunnel

echo.
echo [5/5] Menyimpan Konfigurasi Auto-Start (Supaya nyala otomatis saat laptop restart)...
call npm install -g pm2-windows-startup
call pm2-startup install
call pm2 save

echo.
echo ===================================================
echo INSTALASI SELESAI! SEMUA BERJALAN OTOMATIS 24/7!
echo ===================================================
echo Dashboard bisa diakses di: http://localhost:3000
echo Atau dari luar di: https://crm.kirimfoto.com
echo.
echo Untuk melihat log/error, ketik: pm2 logs
echo.
pause
