@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ╔══════════════════════════════════════════╗
echo ║    V2-Core Deploy Script (Safe Mode)    ║
echo ╚══════════════════════════════════════════╝
echo.
echo ⚠️  PASTIKAN KAMU BERADA DI LAPTOP SERVER!
echo ⚠️  Script ini akan STOP → CLEAN → BUILD → START
echo.

:: ─── Step 0: Cek PM2 ───────────────────────────────────────────
echo [0/7] Cek status PM2...
pm2 list >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ PM2 tidak terinstal atau tidak ada di PATH!
    echo    Install: npm i -g pm2
    pause
    exit /b 1
)
echo ✅ PM2 ready

:: ─── Step 1: Stop app ──────────────────────────────────────────
echo.
echo [1/7] Menghentikan aplikasi (graceful shutdown)...
pm2 stop "v2-core\backend\ecosystem.config.js" 2>nul
pm2 stop wa-crm-v2 2>nul
echo ✅ App berhenti

:: ─── Step 2: Bunuh orphan Chrome ───────────────────────────────
echo.
echo [2/7] Membunuh proses Chromium yatim piatu...
taskkill /F /IM chrome.exe /T 2>nul
:: Tunggu file lock lepas
echo    Menunggu 5 detik agar OS release file lock...
timeout /t 5 /nobreak >nul
echo ✅ Chromium cleaned

:: ─── Step 3: Pull code ─────────────────────────────────────────
echo.
echo [3/7] Tarik kode terbaru dari Git...
cd backend
git --no-pager pull origin main
if %errorlevel% neq 0 (
    echo ⚠️ Git pull gagal! Lanjutkan dengan kode yang ada.
)
cd ..
echo ✅ Code pulled

:: ─── Step 4: Install dependencies ──────────────────────────────
echo.
echo [4/7] Install dependencies...
cd backend
call npm install --no-audit --no-fund 2>&1 | findstr /V "up to date"
cd ..
cd frontend
call npm install --no-audit --no-fund 2>&1 | findstr /V "up to date"
cd ..
echo ✅ Dependencies installed

:: ─── Step 5: Build frontend ────────────────────────────────────
echo.
echo [5/7] Build frontend (React + Vite)...
cd frontend
call npm run build
if %errorlevel% neq 0 (
    echo ❌ Frontend build gagal!
    cd ..
    pause
    exit /b 1
)
cd ..
echo ✅ Frontend built

:: ─── Step 6: Build backend (TypeScript) ────────────────────────
echo.
echo [6/7] Build backend (TypeScript)...
cd backend
call npm run build
if %errorlevel% neq 0 (
    echo ❌ Backend build gagal!
    cd ..
    pause
    exit /b 1
)
cd ..
echo ✅ Backend built

:: ─── Step 7: Start app ─────────────────────────────────────────
echo.
echo [7/7] Start aplikasi via PM2...
cd backend
pm2 start ecosystem.config.js
pm2 save
cd ..
echo ✅ App started

:: ─── Final status ──────────────────────────────────────────────
echo.
echo ╔══════════════════════════════════════════╗
echo ║          DEPLOY SELESAI 🎉               ║
echo ╚══════════════════════════════════════════╝
echo.
echo Status PM2:
pm2 status

echo.
echo Cek log error:
echo   pm2 logs wa-crm-v2 --err --lines 20
echo.
echo Cek browser:
echo   Buka http://localhost:3002
echo.
pause
