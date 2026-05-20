# Panduan Operasional & Troubleshooting

> **Untuk:** Developer / Operator yang menjalankan sistem di production

---

## Environment Variables (`.env`)

```env
# ─── REQUIRED ───────────────────────────────────────
OPENAI_API_KEY=sk-proj-...         # API Key OpenAI (WAJIB)

# ─── OPTIONAL (ada default) ─────────────────────────
MODEL_NAME=gpt-4o-mini             # Model AI utama (default: gpt-4o-mini)
ADMIN_USER=admin                   # Username dashboard (default: admin)
ADMIN_PASS=admin123                # Password dashboard (GANTI di production!)
SESSION_SECRET=xxx-yyy-zzz         # Secret untuk session cookie (GANTI di production!)
NODE_ENV=production                # Set agar session.cookie.secure aktif
RAJAONGKIR_API_KEY=xxx             # Untuk fitur cek ongkir JNE
DATA_DIR=/var/data/crm             # Custom data directory (default: ./data)
ORIGIN_NAME=Kediri                 # Kota asal pengiriman (default: Kediri)
WAJS_ENABLED=true                  # Enable hybrid WA-JS injection (default: true)
WAJS_INJECT_TIMEOUT_MS=30000       # Timeout inject WA-JS
ADMIN_USERS_JSON=[{"user":"admin","pass":"admin123","role":"admin"}] # Multi-user RBAC opsional
LOG_MAX_SIZE_MB=5                  # Rotate logs/app.log saat melewati ukuran ini
LOG_MAX_FILES=5                    # Jumlah file rotasi app.log.N yang disimpan
TEMP_CLEANUP_MAX_AGE_MS=3600000    # Umur file temp sebelum dibersihkan saat startup
RAJAONGKIR_CACHE_TTL_MS=604800000  # TTL cache Komerce/RajaOngkir
CLIENT_LAUNCH_TIMEOUT_MS=120000    # Timeout launch tiap sesi WA agar store lain tetap lanjut
```

---

## Menjalankan Sistem

### Development (Local)
```bash
node index.js
# atau
npm start
```

### Production (VPS dengan PM2)
```bash
pm2 start index.js --name wa-ai-cs
pm2 save
pm2 startup
```

### Docker
```bash
docker build -t wa-ai-cs .
docker run -d \
  --name wa-ai-cs \
  -p 3000:3000 \
  -v /var/data/crm:/usr/src/app/data \
  --env-file .env \
  wa-ai-cs
```

---

## Startup Sequence

Sistem melakukan langkah-langkah ini setiap startup:

1. **Config validation** — cek `OPENAI_API_KEY` ada
2. **Database init** — buat tabel, jalankan migrasi safe, backfill data
3. **Backup service** — setup timer backup otomatis + ambil 1 snapshot
4. **Dashboard** — jalankan Express server di port 3000
5. **Load stores** — ambil semua Store dari DB
6. **Launch stores** — untuk setiap Store, launch Chromium browser secara bergiliran
   - Jeda 15 detik antar-browser (mencegah RAM spike)
7. **Health check** — setup timer health check setiap 5 menit per browser

---

## Troubleshooting Umum

### ❌ Bot tidak membalas pesan

**Cek urutan:**
1. Dashboard → apakah status store "Dihubungkan (Online)"?
2. Buka `http://localhost:3000/#/connect` → cek toggle "Auto-Reply AI" apakah nyala?
3. Cek log server — harus ada `[Settings] dhea-6466 updated: {"is_bot_active":true}`
4. Cek apakah kontak dalam status "Pause" (Human Override)?
5. Cek apakah store sudah terikat ke BotAgent di Settings?
6. Cek `logs/app.log` untuk error AI/timeout

---

### ❌ QR Code tidak muncul di dashboard

**Kemungkinan penyebab:**
- Chromium gagal launch → lihat error di log
- Port 3000 sudah dipakai proses lain
- Session lama corrupt → hapus folder `.wwebjs_auth/session-{storeId}`

**Solusi:**
```bash
# Hapus session corrupt
rm -rf .wwebjs_auth/session-{storeId}
# Restart
pm2 restart wa-ai-cs
```

### Error `EADDRINUSE: address already in use :::3000`

Artinya sudah ada proses server lama yang masih memakai port 3000. Ini biasanya terjadi jika `npm start` dijalankan lagi saat `node index.js` sebelumnya belum dimatikan.

PowerShell:
```powershell
Get-NetTCPConnection -LocalPort 3000 | Select-Object LocalAddress,LocalPort,State,OwningProcess
Get-Process -Id <PID>
Stop-Process -Id <PID> -Force
npm start
```

Jika dashboard memang sudah bisa dibuka di `http://localhost:3000`, jangan jalankan `npm start` kedua kali.

---

### ❌ Memory (RAM) terus naik

**Penyebab:** Cache Chromium membengkak setelah berhari-hari
**Solusi:**
1. Sistem sekarang otomatis bersihkan cache saat startup
2. Restart rutin setiap 3-7 hari via PM2 cron:
```bash
pm2 restart wa-ai-cs --cron "0 3 * * 0"  # Restart setiap Minggu jam 3 pagi
```

---

### ❌ Bot membalas lebih dari sekali (triple reply)

**Penyebab:** Event listeners terduplikasi
**Solusi:** Sistem sudah ada `initializedClients` Set yang mencegah duplikasi. Jika masih terjadi:
1. Pastikan tidak ada code yang memanggil `setupEventListeners()` lebih dari sekali
2. Restart bot

---

### ❌ AI balasan lambat / timeout

**Cek:**
1. Status OpenAI API: https://status.openai.com
2. AI Queue penuh (> 3 concurrent)? Cek log `[AI Queue] Antrean digugurkan`
3. Network timeout ke OpenAI? Cek firewall VPS

---

### ❌ Media gagal terkirim

**Kemungkinan:**
1. File tidak ada di `UPLOADS_DIR` → cek folder `data/uploads/`
2. File corrupt → coba upload ulang
3. Ukuran file melebihi batas (5MB untuk foto, 16MB untuk video)

---

## Monitoring Real-time

Dashboard di `http://localhost:3000` menampilkan:
- Status koneksi setiap Store (real-time via Socket.io)
- Log sistem (BOT, ERROR events)
- RAM & CPU usage (update setiap 10 detik)
- Riwayat chat masuk dan keluar
- Status analisis media (pending/processing/done/failed)

---

## Backup & Recovery

### Backup Otomatis
- Scheduler backup berjalan otomatis (interval dikonfigurasi di `backup_service.js`)
- Tersimpan di folder `backups/` dengan nama `snapshot-{timestamp}.sqlite`

### Manual Backup
```bash
# Via API
GET http://localhost:3000/api/system/backups

# Via file system (saat bot tidak jalan)
cp data/database.sqlite backups/manual-$(date +%Y%m%d).sqlite
```

### Recovery
```bash
# Stop bot
pm2 stop wa-ai-cs

# Replace database
cp backups/snapshot-xxx.sqlite data/database.sqlite

# Start bot
pm2 start wa-ai-cs
```

---

## Log Management

Log tersimpan di `logs/app.log`. Format:
```
[19/5/2026, 17:00:00] [INFO] Status pesan...
[19/5/2026, 17:00:01] [SUCCESS] Operasi berhasil...
[19/5/2026, 17:00:02] [ERROR] Terjadi kesalahan...
```

### Download via API:
```
GET http://localhost:3000/api/system/logs
```

### Rotation otomatis

Logger otomatis rotate `logs/app.log` saat ukuran melewati `LOG_MAX_SIZE_MB`.
File lama disimpan sebagai `logs/app.log.1`, `logs/app.log.2`, dan seterusnya sampai `LOG_MAX_FILES`.

---

## WA-JS Hybrid Runtime

Sistem tetap memakai WWebJS sebagai core, lalu menginject `@wppconnect/wa-js` saat WhatsApp client siap.

Health check:
```
GET http://localhost:3000/api/system/wa-js
```

Jika `injected: false`, sistem tetap berjalan dengan WWebJS. Cek `logs/app.log` untuk detail error injeksi.
