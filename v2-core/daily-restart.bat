@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   V2-Core Daily Clean Restart
echo   %date% %time%
echo ============================================

:: 1. Stop app
echo [1/4] Stop app...
pm2 stop ecosystem.config.js
timeout /t 5 /nobreak >nul

:: 2. Kill orphan Chrome
echo [2/4] Kill orphan Chrome...
taskkill /F /IM chrome.exe /T >nul 2>&1
timeout /t 5 /nobreak >nul

:: 3. Clear Chromium cache (reduce disk + memory bloat)
echo [3/4] Clear Chromium caches...
cd backend
if exist ".wwebjs_auth" (
    for /d %%s in (".wwebjs_auth\session-*") do (
        if exist "%%s\Default\Cache" rd /s /q "%%s\Default\Cache" >nul 2>&1
        if exist "%%s\Default\Code Cache" rd /s /q "%%s\Default\Code Cache" >nul 2>&1
        if exist "%%s\Default\Service Worker\CacheStorage" rd /s /q "%%s\Default\Service Worker\CacheStorage" >nul 2>&1
    )
)
cd ..

:: 4. Start app
echo [4/4] Start app...
pm2 start ecosystem.config.js
pm2 save

echo.
echo ✅ Daily restart selesai - %time%
echo.
