/**
 * ecosystem.config.js — PM2 Config untuk V2-Core
 *
 * V2-Core berjalan di PORT 3002 (berbeda dari legacy port 3001)
 * sehingga keduanya bisa berjalan PARALEL tanpa konflik.
 *
 * Cara deploy (zero-risk, bukan zero-downtime):
 *   pm2 stop v2-core/backend/ecosystem.config.js
 *   taskkill /F /IM chrome.exe /T 2>nul
 *   cd v2-core && git pull origin main
 *   cd backend && npm run build && cd ../frontend && npm run build && cd ../..
 *   pm2 start v2-core/backend/ecosystem.config.js
 *
 * JANGAN pakai pm2 reload/restart untuk deploy!
 * WA session + Chromium browser tidak kompatibel dengan rolling restart.
 */

module.exports = {
  apps: [
    {
      name: "wa-crm-v2",
      script: "dist/app.js",
      cwd: __dirname,
      instances: 1, // HARUS 1 — SQLite tidak mendukung multi-instance
      exec_mode: "fork", // HARUS fork — bukan cluster

      // ─── Startup ──────────────────────────────────────────────────────
      // Tunggu app signal 'ready' (wait_ready) + Chromium launch time
      wait_ready: true,
      listen_timeout: 120000, // 2 menit — cukup untuk Chromium x N session

      // ─── Graceful Shutdown (KRITIS — jangan diubah sembarangan) ───────
      // kill_timeout HARUS > total waktu destroy semua Chromium (5-8 detik/session)
      kill_timeout: 90000, // 90 detik — cukup untuk gracefulShutdown
      kill_retry_time: 500, // Cek tiap 500ms apakah proses sudah mati

      // ─── Auto-Restart Policy (ketat — hanya untuk crash recovery) ─────
      autorestart: true,
      max_restarts: 3, // Maksimum 3x restart per window — cegah loop
      min_uptime: "60s", // Harus hidup minimal 60 detik (jangan restart prematur)
      restart_delay: 10000, // Jeda 10 detik antar restart (tunggu OS cleanup)
      max_restarts_expo: 30000, // Exponential backoff: max 30s delay antar restart

      // ─── Memory Guard ─────────────────────────────────────────────────
      // 4GB = aman untuk Node.js + 3-5 Chromium (masing-masing ~400MB heap)
      max_memory_restart: "4000M",

      // ─── Logging ─────────────────────────────────────────────────────
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      max_size: "10M", // Rotate log jika > 10MB

      // ─── Environment ──────────────────────────────────────────────────
      // .env adalah sumber utama. Variabel di sini sebagai fallback darurat.
      env: {
        NODE_ENV: "production",
        PORT: "3002",
        DATA_DIR: "D:\\CRM-AI\\data",
        WA_CHROMIUM_HEAP_MB: "384",
        PM2_MAX_MEMORY: "4000",
      },
    },
  ],
};
