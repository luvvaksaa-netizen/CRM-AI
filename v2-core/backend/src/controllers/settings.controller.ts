import { Request, Response, NextFunction } from 'express';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { Store, AdminConfig } from '../models';
import { getBackupPath, getDbPath, getLogsPath } from '../config/paths';
import bcrypt from 'bcrypt';

// ─── CPU snapshot for delta-based calculation (Windows-compatible) ───
let prevCpuTimes: { idle: number; total: number } | null = null;

// ─── Existing store settings (keep for backward compat) ───

export const getStoreSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const s: any = await Store.findOne({ where: { wa_id: req.params.storeId } });
    if (!s) return res.status(404).json({ error: 'Store tidak ditemukan.' });
    const status = 'Offline';
    res.json({ ...s.dataValues, status });
  } catch (e) {
    next(e);
  }
};

export const updateStoreSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, is_bot_active, agent_id } = req.body;
    const store = await Store.findOne({ where: { wa_id: req.params.storeId } });
    if (!store) return res.status(404).json({ success: false, message: 'Store tidak ditemukan.' });

    const wasBotInactive = (store as any).is_bot_active === false;
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (is_bot_active !== undefined) updateData.is_bot_active = is_bot_active;
    if (agent_id !== undefined) updateData.agent_id = agent_id ? parseInt(agent_id) : null;
    await store.update(updateData);
    await store.reload();
    res.json({ success: true, store: store.dataValues });

    const botJustActivated = wasBotInactive && is_bot_active === true;
    if (botJustActivated) {
      try {
        const { onBotActivated } = require('../services/bot_activation_service');
        onBotActivated(req.params.storeId).catch((e: any) => console.warn(e.message));
      } catch (_) {}
    }
  } catch (e) {
    next(e);
  }
};

// ─── Helper: resolve paths ───

// Gunakan centralized path helper dari config/paths.ts
const BACKUP_DIR = getBackupPath();
const DB_FILE = getDbPath();
// ─── System Health ───

export const getHealth = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramPercent = Math.round((usedMem / totalMem) * 100);

    const cpus = os.cpus();
    const cpuCount = cpus.length;
    // Delta-based CPU calculation (works on Windows where os.loadavg() returns [0,0,0])
    let idle = 0, total = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        total += cpu.times[type as keyof typeof cpu.times];
      }
      idle += cpu.times.idle;
    }
    let cpuLoad = 0;
    let cpuPercent = 0;
    if (prevCpuTimes) {
      const idleDelta = idle - prevCpuTimes.idle;
      const totalDelta = total - prevCpuTimes.total;
      cpuLoad = totalDelta > 0 ? (totalDelta - idleDelta) / cpuCount : 0;
      cpuPercent = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;
    }
    prevCpuTimes = { idle, total };

    const uptime = process.uptime(); // Node process uptime in seconds
    const sysUptime = os.uptime();   // System uptime in seconds

    // Format uptime
    const formatUptime = (secs: number) => {
      const d = Math.floor(secs / 86400);
      const h = Math.floor((secs % 86400) / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const parts = [];
      if (d > 0) parts.push(`${d}h`);
      if (h > 0) parts.push(`${h}j`);
      parts.push(`${m}m`);
      return parts.join(' ');
    };

    res.json({
      ram: { total: totalMem, used: usedMem, free: freeMem, percent: ramPercent },
      cpu: { count: cpuCount, load: cpuLoad, percent: Math.min(cpuPercent, 100) },
      uptime: { process: formatUptime(uptime), system: formatUptime(sysUptime), processRaw: uptime, systemRaw: sysUptime },
      hostname: os.hostname(),
      platform: os.platform(),
    });
  } catch (e) {
    next(e);
  }
};

// ─── Download debug logs ───

export const downloadLogs = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const logPath = path.join(getLogsPath(), 'app.log');
    if (!fs.existsSync(logPath)) {
      return res.status(404).json({ error: 'File log tidak ditemukan.' });
    }
    res.download(logPath, 'debug-logs.txt');
  } catch (e) {
    next(e);
  }
};

// ─── Database Backups ───

export const getBackups = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      return res.json([]);
    }
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.sqlite'))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return {
          name: f,
          size: stat.size,
          created: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
    res.json(files);
  } catch (e) {
    next(e);
  }
};

export const createBackup = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    // Check source DB exists
    if (!fs.existsSync(DB_FILE)) {
      return res.status(400).json({ error: 'Database source tidak ditemukan.' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `snapshot-${timestamp}.sqlite`;
    const backupPath = path.join(BACKUP_DIR, backupName);

    fs.copyFileSync(DB_FILE, backupPath);

    // Also call the legacy backup service for consistency
    try {
      const { performBackup } = require('../services/backup_service');
      performBackup(true);
    } catch (_) {}

    const stat = fs.statSync(backupPath);
    res.json({ success: true, backup: { name: backupName, size: stat.size, created: stat.mtime.toISOString() } });
  } catch (e) {
    next(e);
  }
};

export const deleteBackup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const backupName = String(req.params.name);
    // Security: prevent path traversal
    const safeName = path.basename(backupName);
    if (!safeName || safeName === '..' || safeName.includes('/') || safeName.includes('\\')) {
      return res.status(400).json({ error: 'Nama backup tidak valid.' });
    }
    const backupPath = path.join(BACKUP_DIR, safeName);
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: 'Backup tidak ditemukan.' });
    }
    fs.unlinkSync(backupPath);
    res.json({ success: true, message: `Backup ${safeName} dihapus.` });
  } catch (e) {
    next(e);
  }
};

export const downloadBackup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const backupName = String(req.params.name);
    const safeName = path.basename(backupName);
    if (!safeName || safeName === '..' || safeName.includes('/') || safeName.includes('\\')) {
      return res.status(400).json({ error: 'Nama backup tidak valid.' });
    }
    const backupPath = path.join(BACKUP_DIR, safeName);
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: 'Backup tidak ditemukan.' });
    }
    res.download(backupPath, safeName);
  } catch (e) {
    next(e);
  }
};

// ─── WA Engine Status ───

export const getWAStatus = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let engineRunning = false;
    let activeSessions = 0;
    let sessionDetails: any[] = [];

    try {
      const whatsappService = require('../whatsapp_service');
      const clients = whatsappService.getClients ? whatsappService.getClients() : new Map();
      activeSessions = clients.size;

      if (clients.size > 0) {
        engineRunning = true;
        clients.forEach((_client: any, storeId: string) => {
          sessionDetails.push({ storeId, status: 'ACTIVE' });
        });
      }
    } catch (e: any) {
      // WA service not available — this is fine in v2-core standalone
      engineRunning = false;
    }

    res.json({
      engineRunning,
      activeSessions,
      sessions: sessionDetails,
    });
  } catch (e) {
    next(e);
  }
};

export const restartWA = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let restarted = false;
    try {
      const whatsappService = require('../whatsapp_service');
      const { Store: StoreModel } = require('../models');

      if (whatsappService.restartClientRuntime) {
        const stores = await StoreModel.findAll({ where: { is_bot_active: true } });
        for (const store of stores) {
          try {
            await whatsappService.restartClientRuntime(store.wa_id, 'user-request');
          } catch (_) {}
        }
        restarted = true;
      }
    } catch (e: any) {
      // WA service might not be running
    }

    if (restarted) {
      res.json({ success: true, message: 'WA Engine restart dimulai.' });
    } else {
      res.json({ success: false, message: 'WA Engine tidak berjalan — tidak ada yang direstart.' });
    }
  } catch (e) {
    next(e);
  }
};

// ─── Admin Profile ───

const BCRYPT_ROUNDS = 10;

export const updateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newUsername, newPassword, confirmPassword } = req.body;

    // Validate
    if (!currentPassword) return res.status(400).json({ error: 'Password saat ini wajib diisi.' });

    // Get current admin record (use JWT username to identify which admin to update)
    const reqUser = (req as any).user;
    const currentUsername = reqUser?.username || process.env.ADMIN_USER || 'admin';

    const adminRecord = await AdminConfig.findOne({ where: { username: currentUsername } });
    if (!adminRecord) {
      return res.status(500).json({ error: 'Akun admin tidak ditemukan di database.' });
    }

    const rec = adminRecord as any;

    // Verify current password against bcrypt hash
    const valid = await bcrypt.compare(currentPassword, rec.password_hash);
    if (!valid) {
      return res.status(403).json({ error: 'Password saat ini salah.' });
    }

    // Validate new values
    if (newPassword) {
      if (newPassword.length < 4) {
        return res.status(400).json({ error: 'Password baru minimal 4 karakter.' });
      }
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'Konfirmasi password tidak cocok.' });
      }
    }

    // Build update payload
    const updateData: any = { updated_at: new Date() };
    if (newUsername && newUsername !== rec.username) {
      // Check uniqueness
      const existing = await AdminConfig.findOne({ where: { username: newUsername } });
      if (existing) {
        return res.status(409).json({ error: 'Username sudah digunakan.' });
      }
      updateData.username = newUsername;
    }
    if (newPassword) {
      updateData.password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    }

    await adminRecord.update(updateData);
    await adminRecord.reload();

    const updatedRec = adminRecord as any;
    res.json({
      success: true,
      message: 'Profil berhasil diperbarui.',
      username: updatedRec.username,
    });
  } catch (e) {
    next(e);
  }
};
