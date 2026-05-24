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
OPENAI_TRANSCRIPTION_TIMEOUT_MS=120000 # Timeout Whisper/video transcription
OPENAI_TRANSCRIPTION_RETRIES=3      # Retry transient connection error saat transkripsi
FFMPEG_AUDIO_EXTRACT_TIMEOUT_MS=120000 # Timeout ekstrak audio video untuk Whisper
MEDIA_VIDEO_OPTIMIZE_ENABLED=true   # Kompres video besar untuk pengiriman WA
MEDIA_VIDEO_OPTIMIZE_THRESHOLD_MB=12 # Video di atas ukuran ini dibuatkan MP4 ringan
MEDIA_VIDEO_OPTIMIZE_TIMEOUT_MS=180000 # Timeout kompres video besar
AI_BETWEEN_MEDIA_DELAY_MS=500       # Jeda antar-media saat AI mengirim katalog
OPENAI_CHAT_TIMEOUT_MS=18000        # Timeout panggilan utama AI chat
OPENAI_SECOND_CALL_TIMEOUT_MS=10000 # Timeout panggilan kedua AI setelah tool
AI_MEDIA_FAST_REPLY_ENABLED=true    # Skip second AI call untuk tool media-only
WA_SEND_READY_TIMEOUT_MS=45000      # Tunggu client WA siap sebelum kirim
WA_TYPING_HARD_STOP_MS=7000         # Typing indicator maksimal sekitar 7 detik
WA_TYPING_PULSE_MS=5000             # Refresh typing jika masih dalam window pendek
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

### ❌ Bot masih menjawab padahal server dimatikan / dinonaktifkan

**Penyebab 1: Zombie Puppeteer/Chromium di Background**
Saat server Node.js dihentikan secara paksa (Ctrl+C atau close terminal), proses headless Chromium/Puppeteer yang di-spawn oleh WWebJS tidak selalu mati secara otomatis. Proses ini tetap berjalan di background sistem (Task Manager) dan terus terhubung ke WhatsApp Web melalui WebSocket, sehingga tetap menerima pesan masuk dan membalasnya.

**Penyebab 2: Bot Berjalan Ganda (Development vs Production Server)**
Jika Anda menggunakan satu akun WhatsApp yang sama di laptop development dan server lokal/production secara bersamaan:
- Menghidupkan server di laptop dev akan ikut membalas pesan.
- Jika database SQLite di laptop dev memiliki toggle `is_bot_active` yang masih `true` (ON), ia tetap membalas, walaupun dashboard server lokal sudah dimatikan/dinonaktifkan (karena databasenya berbeda).

**Solusi:**
1. Matikan semua zombie Chrome/Chromium di laptop/server menggunakan command prompt:
   - **Windows PowerShell:**
     ```powershell
     taskkill /F /IM chrome.exe
     taskkill /F /IM node.exe
     ```
   - **Linux:**
     ```bash
     killall chrome chromium-browser node
     ```
2. Pastikan hanya ada **satu** server bot yang berjalan untuk satu akun WA. Jangan jalankan `npm start` di laptop dev jika server lokal sedang aktif memproses chat.

---

### ❌ AI balasan lambat / timeout

**Cek:**
1. Status OpenAI API: https://status.openai.com
2. AI Queue penuh (> 3 concurrent)? Cek log `[AI Queue] Antrean digugurkan`
3. Network timeout ke OpenAI? Cek firewall VPS
4. Jika log berulang "AI masih membalas ... Batch baru digabung", customer sedang mengirim beberapa pesan saat satu jawaban aktif. Sistem menggabungkan batch tersebut agar tidak antre serial.
5. Jika opening mengirim video, pastikan upload video sudah selesai dianalisis dan log menunjukkan `Video dioptimalkan untuk WA`. Video asli 20MB bisa membuat upload WhatsApp terasa lama.

---

### ❌ Media gagal terkirim

**Kemungkinan:**
1. File tidak ada di `UPLOADS_DIR` → cek folder `data/uploads/`
2. File corrupt → coba upload ulang
3. Ukuran file melebihi batas (5MB untuk foto, 16MB untuk video)

### Video upload: Whisper `Connection error`

Sistem mengekstrak audio video ke MP3 kecil sebelum memanggil Whisper. Jika masih gagal:
1. Cek log `[Whisper] Audio video diekstrak` untuk memastikan ffmpeg berhasil.
2. Cek koneksi server ke OpenAI dan nilai `OPENAI_TRANSCRIPTION_TIMEOUT_MS`.
3. Jika video tidak punya audio track, log akan menulis "Video tidak memiliki audio" dan analisis visual tetap berjalan.
4. Untuk video katalog yang sering dikirim ke customer, jaga file hasil optimasi di bawah 8-12MB agar pengiriman WhatsApp cepat.

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

Catatan recovery:
- Startup sync memakai `WPP.chat.list()` dan `WPP.chat.getMessages()` jika tersedia. Quoted metadata dibaca defensively; pesan yang bukan reply tidak boleh menyebabkan error `does not have a reply`.
- Jika health check mendeteksi browser hang/detached, sistem melakukan restart runtime tanpa menghapus folder sesi `.wwebjs_auth`. Manual logout tetap memakai jalur `logoutClient()` dan memang membersihkan sesi.
- Jika follow-up/manual/AI terkirim saat browser sedang recovery, pengirim akan menunggu `WA_SEND_READY_TIMEOUT_MS` sebelum gagal.

Troubleshooting log umum:
- `WA-JS addScriptTag belum berhasil... inline injection` masih normal selama akhirnya muncul `WA-JS aktif`.
- `does not have a reply` pada sync harus hilang setelah update ini. Jika muncul lagi, cek versi `@wppconnect/wa-js` dan simpan contoh `wa_message_id`.
- `Attempted to use detached Frame` yang muncul sekali akan memicu recovery. Jika berulang terus, restart proses Node dan cek RAM/CPU laptop server.
