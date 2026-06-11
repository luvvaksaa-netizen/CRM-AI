import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { AuthRequest } from '../middlewares/auth.middleware';
import { AdminConfig } from '../models';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Environment variable ${name} is required but not set`);
  return val;
}

const JWT_SECRET = requireEnv('JWT_SECRET');
const ADMIN_USER = requireEnv('ADMIN_USER');
const ADMIN_PASS = requireEnv('ADMIN_PASS');
const BCRYPT_ROUNDS = 10;

/**
 * Seed or retrieve admin credentials from database.
 * On first run (empty table), auto-seeds from ADMIN_USER/ADMIN_PASS env vars
 * with bcrypt hashing, so admin/admin123 works out of the box.
 * Also seeds additional users from ADMIN_USERS_JSON if provided.
 */
async function getOrSeedAdminUser(username: string): Promise<{ username: string; password_hash: string; role: string } | null> {
  try {
    // Check if admin_config table has any rows
    const count = await AdminConfig.count();
    if (count === 0) {
      // Seed from env vars
      const defaultPassHash = await bcrypt.hash(ADMIN_PASS, BCRYPT_ROUNDS);
      await AdminConfig.create({ username: ADMIN_USER, password_hash: defaultPassHash, role: 'admin' });

      // Also seed additional users from ADMIN_USERS_JSON if provided
      if (process.env.ADMIN_USERS_JSON) {
        try {
          const users: any[] = JSON.parse(process.env.ADMIN_USERS_JSON);
          for (const u of users) {
            const uName = String(u.user);
            // Skip if already seeded as default admin
            if (uName === ADMIN_USER) continue;
            const uPassHash = await bcrypt.hash(String(u.pass), BCRYPT_ROUNDS);
            await AdminConfig.create({ username: uName, password_hash: uPassHash, role: u.role || 'operator' });
          }
        } catch (_) {
          console.warn('[Auth] ADMIN_USERS_JSON parse error — skipping extra users');
        }
      }
      console.log('[Auth] Admin credentials seeded to database with bcrypt hashing');
    }

    // Look up the requested user
    const record = await AdminConfig.findOne({ where: { username } });
    if (!record) return null;

    const rec = record as any;
    return { username: rec.username, password_hash: rec.password_hash, role: rec.role };
  } catch (dbErr: any) {
    // Database not available — fallback to env vars with bcrypt hashing on-the-fly
    console.error('[Auth] Database error, falling back to env vars:', dbErr.message);
    const passHash = await bcrypt.hash(ADMIN_PASS, BCRYPT_ROUNDS);
    return { username: ADMIN_USER, password_hash: passHash, role: 'admin' };
  }
}

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user, pass } = req.body;

    if (!user || !pass) {
      return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
    }

    const account = await getOrSeedAdminUser(user);
    if (!account) {
      return res.status(401).json({ success: false, message: 'Username atau password salah.' });
    }

    const valid = await bcrypt.compare(pass, account.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Username atau password salah.' });
    }

    const token = jwt.sign({ username: account.username, role: account.role }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ success: true, message: 'Login berhasil!', token, role: account.role });
  } catch (e) {
    next(e);
  }
};

export const getSession = (req: AuthRequest, res: Response) => {
  if (req.user) {
    res.json({ user: req.user.username, role: req.user.role });
  } else {
    res.status(401).json({ error: 'Tidak ada sesi' });
  }
};
