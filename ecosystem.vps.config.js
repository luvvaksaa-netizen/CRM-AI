/**
 * ecosystem.vps.config.js — PM2 Process Manager Configuration for VPS
 *
 * Mode: V2-Core Only (single app serves API + Frontend + WA Bot)
 *
 * Cara pakai:
 *   pm2 start ecosystem.vps.config.js
 *   pm2 reload ecosystem.vps.config.js
 *   pm2 restart ecosystem.vps.config.js
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
        // DATA_DIR: akan di-override oleh .env file di v2-core/backend/.env
      },
    },
  ],
};
