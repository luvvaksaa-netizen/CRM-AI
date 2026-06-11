/**
 * ecosystem.config.js — PM2 Config untuk V2-Core
 *
 * V2-Core berjalan di PORT 3002 (berbeda dari legacy port 3001)
 * sehingga keduanya bisa berjalan PARALEL tanpa konflik.
 *
 * Cara pakai:
 *   pm2 start ecosystem.config.js       (pertama kali)
 *   pm2 reload ecosystem.config.js      (update tanpa downtime)
 *   pm2 restart ecosystem.config.js     (restart)
 */

module.exports = {
  apps: [
    {
      name: 'wa-crm-v2',
      script: 'dist/app.js',   // compiled TypeScript output
      cwd: './',
      instances: 1,            // HARUS 1 — SQLite tidak mendukung multi-instance
      exec_mode: 'fork',       // HARUS fork — bukan cluster

      // ─── Graceful Shutdown ───────────────────────────────────────────
      // Tunggu sinyal 'ready' dari process.send('ready') sebelum
      // menganggap proses baru siap dan mematikan proses lama.
      wait_ready: true,
      listen_timeout: 90000,   // Tunggu max 90 detik (banyak WA session, lambat init)
      kill_timeout: 15000,     // Beri 15 detik untuk graceful shutdown sebelum SIGKILL

      // ─── Auto-Restart Policy ─────────────────────────────────────────
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',       // Anggap crash jika mati dalam 15 detik pertama
      restart_delay: 3000,     // Tunggu 3 detik sebelum restart otomatis

      // ─── Memory Guard ────────────────────────────────────────────────
      max_memory_restart: '1500M',

      // ─── Logging ─────────────────────────────────────────────────────
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',

      // ─── Environment ─────────────────────────────────────────────────
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
    },
  ],
};
