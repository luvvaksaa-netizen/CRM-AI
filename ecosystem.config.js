/**
 * ecosystem.config.js — PM2 Process Manager Configuration
 *
 * MODE: V2-Core Only (Legacy dinonaktifkan)
 * V2-Core sudah menangani semua: WA Bot + Dashboard API + Frontend
 *
 * Cara pakai:
 *   pm2 start ecosystem.config.js       (pertama kali)
 *   pm2 reload ecosystem.config.js      (update tanpa downtime)
 *   pm2 restart ecosystem.config.js     (restart normal)
 */

module.exports = {
  apps: [
    {
      name: 'v2-core-api',
      script: 'dist/app.js',
      cwd: './v2-core/backend',
      instances: 1,
      exec_mode: 'fork',

      // ─── Graceful Shutdown ───────────────────────────────────────────
      kill_timeout: 15000,

      // ─── Auto-Restart Policy ─────────────────────────────────────────
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,

      // ─── Memory Guard ────────────────────────────────────────────────
      max_memory_restart: '1500M',

      // ─── Logging ─────────────────────────────────────────────────────
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '../../logs/v2-core-error.log',
      out_file: '../../logs/v2-core-out.log',

      // ─── Environment ─────────────────────────────────────────────────
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        DATA_DIR: 'C:\\Users\\Lenovo\\Documents\\CRM-AI\\data',
        // Fallback rahasia jika .env tidak ada
        ADMIN_USER: 'admin',
        ADMIN_PASS: 'KirimFotoSecure99!',
        JWT_SECRET: 'v2core-crm-jwt-secret-lenovo-desktop-2024-xK9mP',
        CORS_ORIGINS: 'http://localhost:5173,http://localhost:3002',
      },
    },
    {
      name: 'v2-core-frontend',
      script: 'node_modules/vite/bin/vite.js',
      args: 'preview --port 5173 --host 0.0.0.0',
      cwd: './v2-core/frontend',
      instances: 1,
      exec_mode: 'fork',

      // ─── Graceful Shutdown ───────────────────────────────────────────
      kill_timeout: 5000,

      // ─── Auto-Restart Policy ─────────────────────────────────────────
      autorestart: true,
      max_restarts: 10,
      min_uptime: '5s',
      restart_delay: 2000,

      // ─── Logging ─────────────────────────────────────────────────────
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '../../logs/frontend-error.log',
      out_file: '../../logs/frontend-out.log',

      // ─── Environment ─────────────────────────────────────────────────
      env: {
        NODE_ENV: 'production',
      },
    }
  ],
};
