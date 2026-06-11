import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Environment variable ${name} is required but not set`);
  return val;
}

const JWT_SECRET = requireEnv('JWT_SECRET');

export interface AuthRequest extends Request {
  user?: {
    username: string;
    role: string;
  };
}

export const authenticateJWT = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json({ success: false, message: 'Token tidak valid / expired.' });
      }
      req.user = user as any;
      next();
    });
  } else {
    res.status(401).json({ success: false, message: 'Unauthorized. Harap login.' });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.user?.role || 'viewer';
    if (role === 'admin' || roles.includes(role)) {
      next();
    } else {
      res.status(403).json({ success: false, message: 'Akses ditolak untuk role Anda.' });
    }
  };
};
