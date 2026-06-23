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
      // cwd: pakai path absolut agar dotenv selalu menemukan .env di folder ini
      cwd: __dirname,
      instances: 1,            // HARUS 1 — SQLite tidak mendukung multi-instance
      exec_mode: 'fork',       // HARUS fork — bukan cluster

      // ─── Graceful Shutdown ───────────────────────────────────────────
      wait_ready: true,
      listen_timeout: 90000,
      kill_timeout: 15000,

      // ─── Auto-Restart Policy ─────────────────────────────────────────
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 3000,

      // ─── Memory Guard ────────────────────────────────────────────────
      max_memory_restart: '1500M',

      // ─── Logging ─────────────────────────────────────────────────────
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',

      // ─── Environment (fallback — .env adalah sumber utama) ───────────
      // Variabel ini sebagai fallback jika .env tidak terbaca.
      // Sumber utama tetap file .env di folder ini.
      env: {
        NODE_ENV: 'production',
        PORT: '3002',
        DATA_DIR: 'D:\\CRM-AI\\data',
        ADMIN_USER: 'admin',
        ADMIN_PASS: 'KirimFotoSecure99!',
        JWT_SECRET: 'v2core-crm-jwt-secret-lenovo-desktop-2024-xK9mP',
        CORS_ORIGINS: 'http://localhost:5173,http://localhost:3002',
      },
    },
  ],
};
