import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

const logError = (err: any) => {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    const message = err instanceof Error ? err.stack || err.message : String(err);
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ERROR: ${message}\n`);
  } catch {
    console.error('Failed to write to log file:', err);
  }
};

const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  // Log detail error ke app.log
  logError(err);
  // Log ke console untuk development
  console.error('[ErrorHandler]', err instanceof Error ? err.message : String(err));
  
  // Return generic message ke client
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({ error: 'Internal server error' });
};

export default errorHandler;
