@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ╔══════════════════════════════════════════╗
echo ║    V2-Core Deploy Script (Safe Mode)    ║
echo ╚══════════════════════════════════════════╝
echo.

:: Deteksi di mana ecosystem.config.js berada
set "PM2_CONFIG=ecosystem.config.js"
if not exist "ecosystem.config.js" (
    if exist "..\ecosystem.config.js" (
        set "PM2_CONFIG=..\ecosystem.config.js"
        echo 📁 PM2 config ditemukan di parent folder (CRM-AI root)
    )
)

:: ─── Step 0: Cek PM2 ───────────────────────────────────────────
echo [0/7] Cek status PM2...
pm2 list >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ PM2 tidak terinstal!
    echo    Install: npm i -g pm2
    pause
    exit /b 1
)
echo ✅ PM2 ready

:: ─── Step 1: Stop app ──────────────────────────────────────────
echo.
echo [1/7] Menghentikan aplikasi (graceful shutdown)...
pm2 stop "%PM2_CONFIG%"
echo ✅ App berhenti

:: ─── Step 2: Bunuh orphan Chrome ───────────────────────────────
echo.
echo [2/7] Membunuh proses Chromium orphan...
taskkill /F /IM chrome.exe /T >nul 2>&1
echo    Menunggu 5 detik agar OS release file lock...
timeout /t 5 /nobreak >nul
echo ✅ Chromium cleaned

:: ─── Step 3: Pull code ─────────────────────────────────────────
echo.
echo [3/7] Tarik kode terbaru dari Git...
git --no-pager pull origin main 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  Git pull gagal! Lanjutkan dengan kode yang ada.
)
echo ✅ Code pulled

:: ─── Step 4: Install dependencies ──────────────────────────────
echo.
echo [4/7] Install dependencies...
cd backend
call npm install --no-audit --no-fund >nul 2>&1
cd ..

cd frontend
call npm install --no-audit --no-fund >nul 2>&1
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
pm2 start "%PM2_CONFIG%"
pm2 save
echo ✅ App started

:: ─── Final status ──────────────────────────────────────────────
echo.
echo ╔══════════════════════════════════════════╗
echo ║          DEPLOY SELESAI ✅               ║
echo ╚══════════════════════════════════════════╝
echo.
echo Status PM2:
pm2 status

echo.
echo Cek log error:
echo   pm2 logs v2-core-api --err --lines 20
echo.
echo Cek browser:
echo   Buka https://crm.datasdm.com
echo.
pause
