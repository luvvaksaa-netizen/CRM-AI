# CRM-AI Server Startup Script
# Jalankan script ini untuk start semua server setelah laptop mati/restart
# Usage: .\start-servers.ps1

Write-Host "=== CRM-AI Server Startup ===" -ForegroundColor Cyan
Write-Host "Waktu: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray

$CRM_DIR = "D:\CRM-AI"

# Kill semua node processes yang masih running (cleanup)
Write-Host "[1/4] Cleanup node processes lama..." -ForegroundColor Yellow
Get-Process | Where-Object {$_.ProcessName -like "*node*"} | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# Kill PM2 daemon yang mungkin sudah mati
Write-Host "[2/4] Kill PM2 daemon lama (jika ada)..." -ForegroundColor Yellow
pm2 kill 2>&1 | Out-Null
Start-Sleep -Seconds 2

# Start PM2 dengan ecosystem config
Write-Host "[3/4] Starting PM2 processes..." -ForegroundColor Yellow
Set-Location $CRM_DIR
pm2 start ecosystem.config.js

# Simpan state
Write-Host "[4/4] Saving PM2 state..." -ForegroundColor Yellow
pm2 save --force

Write-Host "" 
Write-Host "=== Status Servers ===" -ForegroundColor Green
pm2 list

Write-Host ""
Write-Host "✅ Semua server berhasil dijalankan!" -ForegroundColor Green
Write-Host ""
Write-Host "Akses:" -ForegroundColor Cyan
Write-Host "  Dashboard V2-Core: http://localhost:5173" -ForegroundColor White
Write-Host "  Backend V2-Core API: http://localhost:3002" -ForegroundColor White
Write-Host "  Legacy Backend (WA): http://localhost:3001" -ForegroundColor White
Write-Host ""
Write-Host "PENTING: Scan ulang QR WhatsApp di Dashboard V2-Core > WA Devices" -ForegroundColor Yellow
