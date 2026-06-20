import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { Server } from 'socket.io';
import { socketService } from './services/socket.service';
import { initDB, sequelize } from './config/database';

const app = express();

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173'];
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins, // Untuk tahap dev
    methods: ['GET', 'POST']
  }
});

// Security: Rate limiting — protect API from brute force
let rateLimit: any;
try {
  rateLimit = require('express-rate-limit');
} catch (_) {
  // Fallback if express-rate-limit not installed
  rateLimit = null;
}

// General API rate limiter: 100 requests per 15 menit per IP
const apiLimiter = rateLimit ? rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak request. Coba lagi dalam 15 menit.' }
}) : (req: any, res: any, next: any) => next();

// Auth endpoint rate limiter: 10 attempts per 15 menit
const authLimiter = rateLimit ? rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' }
}) : (req: any, res: any, next: any) => next();

// Helmet with production-ready CSP
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // allow frontend to load upload images from backend
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", ...allowedOrigins],
    },
  },
}));

// Apply rate limiters
app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '10mb' })); // limit JSON body size

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.urlencoded({ extended: true }));
app.set('io', io); // Buat io tersedia di req.app.get('io') — backward compat
socketService.init(io);

// Inject Socket.IO ke dashboard_service agar addToChatHistory bisa emit 'newMessage'
try {
  const dashboard = require('./services/dashboard_service');
  dashboard.setSocketIO(io);
} catch (e) {
  console.warn('[Socket] dashboard_service.setSocketIO gagal:', (e as any).message);
}

import analyticsRoutes from './routes/analytics.routes';
import chatRoutes from './routes/chat.routes';
import authRoutes from './routes/auth.routes';
import settingsRoutes from './routes/settings.routes';
import followupRoutes from './routes/followup.routes';
import agentRoutes from './routes/agent.routes';
import storesRoutes from './routes/stores.routes';
import mediaRoutes from './routes/media.routes';
import summariesRoutes from './routes/summaries.routes';
import closingRoutes from './routes/closing.routes';
import learningRoutes from './routes/learning.routes';
import smartLabelRoutes from './routes/smart-label.routes';
import botActivationRoutes from './routes/bot-activation.routes';
import openaiBillingRoutes from './routes/openai-billing.routes';
import xenditRoutes from './routes/xendit.routes';
import mengantarRoutes from './routes/mengantar.routes';
import scalevRoutes from './routes/scalev.routes';
import { handleWebhook as xenditWebhook } from './controllers/xendit.controller';
import { handleWebhook as scalevWebhook } from './controllers/scalev.controller';
import { authenticateJWT } from './middlewares/auth.middleware';
import errorHandler from './middleware/errorHandler';
import path from 'path';

// ─── Uploads Directory ───────────────────────────────────────────────────────
// Pakai DATA_DIR dari env agar sesuai dengan lokasi file asli (legacy data folder).
// Fallback ke dist/../data/uploads untuk dev lokal.
const UPLOADS_DIR_STATIC = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR, 'uploads')
  : path.resolve(__dirname, '../data/uploads');

// Frontend dist directory (served in production)
const FRONTEND_DIST = process.env.FRONTEND_DIST
  ? path.resolve(process.env.FRONTEND_DIST)
  : path.resolve(__dirname, '../../frontend/dist');

// Public API
app.use('/api/auth', authRoutes);
// Scalev webhook (PUBLIC — Scalev sends payment callbacks here)
app.post('/api/scalev/webhook', scalevWebhook);
// Xendit webhook (PUBLIC — Xendit sends callbacks here, no JWT)
if (process.env.ENABLE_LEGACY_XENDIT === 'true') {
  app.post('/api/xendit/webhook', xenditWebhook);
} else {
  app.post('/api/xendit/webhook', (req, res) => {
    res.status(410).json({ error: 'Xendit integration is disabled. Use Scalev payment.' });
  });
}
app.use('/uploads', express.static(UPLOADS_DIR_STATIC));

// Protected API
app.use('/api/agents', authenticateJWT, agentRoutes);
app.use('/api/analytics', authenticateJWT, analyticsRoutes);
app.use('/api/chat', authenticateJWT, chatRoutes);
app.use('/api/settings', authenticateJWT, settingsRoutes);
app.use('/api/followups', authenticateJWT, followupRoutes);
app.use('/api/stores', authenticateJWT, storesRoutes);
app.use('/api/media', authenticateJWT, mediaRoutes);
app.use('/api/summaries', authenticateJWT, summariesRoutes);
app.use('/api/closing', authenticateJWT, closingRoutes);
app.use('/api/learning', authenticateJWT, learningRoutes);
app.use('/api/smart-labels', authenticateJWT, smartLabelRoutes);
app.use('/api/bot-activation', authenticateJWT, botActivationRoutes);
app.use('/api/openai/billing', authenticateJWT, openaiBillingRoutes);
// Mengantar shipping routes (protected)
app.use('/api/mengantar', authenticateJWT, mengantarRoutes);
// Scalev order management (protected except webhook above)
app.use('/api/scalev', authenticateJWT, scalevRoutes);

// Xendit Payment Gateway — disabled, use Scalev instead
if (process.env.ENABLE_LEGACY_XENDIT === 'true') {
  app.use('/api/xendit', authenticateJWT, xenditRoutes);
} else {
  app.use('/api/xendit', (req, res) => {
    res.status(410).json({ error: 'Xendit integration is disabled. Use Scalev payment.' });
  });
}


app.get('/health', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ status: 'ok', version: '2.0.0', database: 'connected' });
  } catch (e: any) {
    res.status(503).json({ status: 'error', version: '2.0.0', database: 'disconnected', error: e.message });
  }
});

// ======== Global Error Handler ========
app.use(errorHandler);

// ======== SPA Frontend Serving (production) ========
// Serve built React frontend for all non-API routes
import fs from 'fs';
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  // SPA fallback — Express 5 requires named wildcard: /{*path}
  app.get('/{*path}', (req: any, res: any) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path === '/health') {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
  console.log(`[Frontend] Serving static from ${FRONTEND_DIST}`);
} else {
  console.warn(`[Frontend] dist not found at ${FRONTEND_DIST} — run 'npm run build' in frontend/`);
}

// ======== Socket.IO Connection Handlers ========

io.on('connection', (socket) => {
  console.log('[Socket] Client connected:', socket.id);

  // Re-emit current QR codes so newly connected client gets them instantly
  const currentQrs = socketService.getQRCodes();
  Object.entries(currentQrs).forEach(([storeId, qr]) => {
    socket.emit('qr', { storeId, qr });
  });

  // Allow client to join a store-specific room for targeted updates
  socket.on('joinStore', (storeId: string) => {
    socket.join(`store:${storeId}`);
    console.log(`[Socket] ${socket.id} joined store:${storeId}`);
  });

  socket.on('leaveStore', (storeId: string) => {
    socket.leave(`store:${storeId}`);
    console.log(`[Socket] ${socket.id} left store:${storeId}`);
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Client disconnected:', socket.id);
  });
});

// ======== Backward-compatible re-exports (legacy JS services import these) ========
// All socket emissions are now centralized in socketService.
// These wrappers exist only for legacy code that imports emit* from app.ts directly.

export const emitQR = (storeId: string, qr: string) => socketService.emitQR(storeId, qr);
export const emitReady = (storeId: string) => socketService.emitReady(storeId);
export const emitDisconnected = (storeId: string) => socketService.emitDisconnected(storeId);
export const emitNewMessage = (storeId: string, msg: any) => socketService.emitNewMessage(storeId, msg);
export const emitDashboardUpdate = () => socketService.emitDashboardUpdate();

const PORT = process.env.PORT || 3002;

const initWhatsApp = async () => {
  try {
    // Import from legacy source using absolute or relative path
    const path = require('path');
    const fs = require('fs');
    const whatsappService = require('./whatsapp_service');
    const { Store } = require('./models');

    // === CLEANUP ORPHANED TEMP SESSIONS ===
    // Hapus session-temp_* yang tersisa dari crash atau failed promotion
    // agar tidak menumpuk di disk.
    const authDir = path.join(__dirname, '..', '.wwebjs_auth');
    if (fs.existsSync(authDir)) {
      const entries = fs.readdirSync(authDir);
      let cleanedCount = 0;
      for (const entry of entries) {
        if (entry.startsWith('session-temp_')) {
          const sessionPath = path.join(authDir, entry);
          try {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            cleanedCount++;
            console.log(`[Cleanup] Orphan temp session deleted: ${entry}`);
          } catch (e: any) {
            console.log(`[Cleanup] Failed to delete ${entry}: ${e.message}`);
          }
        }
      }
      if (cleanedCount > 0) {
        console.log(`[Cleanup] Deleted ${cleanedCount} orphan temp session(s)`);
      }
    }

    const stores = await Store.findAll({ where: { is_bot_active: true } });

    for (let i = 0; i < stores.length; i++) {
      const store = stores[i];
      const client = whatsappService.createWhatsAppClient(store.wa_id);
      whatsappService.setupEventListeners(client, store.wa_id, io);

      try {
        await client.initialize();
        console.log(`[WA] ${store.wa_id} initialized`);
      } catch (err: any) {
        console.error(`[WA] Failed to init ${store.wa_id}: ${err.message}`);
      }

      // Stagger delay 15 detik antar browser
      if (i < stores.length - 1) {
        await new Promise(r => setTimeout(r, 15000));
      }
    }
  } catch (err: any) {
    console.error(`[WA] Global init error: ${err.message}`);
  }
};

// ======== Graceful Shutdown ========
// Menangani SIGINT (Ctrl+C) dan SIGTERM (systemd/docker stop)
// Urutan: stop HTTP server -> disconnect WA clients -> close DB -> exit
const gracefulShutdown = async (signal: string) => {
  console.log('[Server] Received ' + signal + '. Starting graceful shutdown...');

  // 1. Stop accepting new connections
  server.close(() => {
    console.log('[Server] HTTP server closed');
  });

  // 2. Force close all Socket.IO connections
  try {
    io.close();
    console.log('[Socket] IO server closed');
  } catch (_) {}

  // 3. Disconnect all WA clients
  try {
    const whatsappService = require('./whatsapp_service');
    if (typeof whatsappService.getClients === 'function') {
      const clients = whatsappService.getClients();
      for (const [storeId, client] of clients) {
        try {
          if (typeof client.destroy === 'function') {
            await client.destroy();
            console.log('[WA] ' + storeId + ' disconnected');
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  // 3.5 Stop OpenAI billing scheduler
  try {
    const { stopScheduler } = require('./services/openaiBilling.service');
    stopScheduler();
    console.log('[OpenAI Billing] Scheduler stopped');
  } catch (_) {}

  // 3.6 Stop Xendit scheduler
  try {
    const { stopScheduler } = require('./services/xendit.service');
    stopScheduler();
    console.log('[Xendit] Scheduler stopped');
  } catch (_) {}

  // 4. Close database connection
  try {
    await sequelize.close();
    console.log('[Database] Connection closed');
  } catch (_) {}

  console.log('[Server] Graceful shutdown complete');
  process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export const startServer = async () => {
  await initDB();

  // Init backup service (auto-backup)
  try {
    const { initBackupService } = require('./services/backup_service');
    initBackupService();
    console.log('[Backup] Auto-backup service initialized');
  } catch (e: any) {
    console.warn('[Backup] Failed to init backup service:', e.message);
  }

  // Init follow-up scheduler
  try {
    const path = require('path');
    const { initFollowUpScheduler } = require('./services/followup.service');
    initFollowUpScheduler(io);
  } catch (e: any) {
    console.error('[FollowUp] Init Error:', e.message);
  }

  // Init OpenAI billing scheduler
  try {
    const { startScheduler } = require('./services/openaiBilling.service');
    startScheduler();
  } catch (e: any) {
    console.warn('[OpenAI Billing] Scheduler init:', e.message);
  }

  // Init Xendit scheduler
  try {
    const { startScheduler } = require('./services/xendit.service');
    startScheduler();
  } catch (e: any) {
    console.warn('[Xendit] Scheduler init:', e.message);
  }

  server.listen(PORT, async () => {
    console.log(`[V2-Core] Server running on port ${PORT}`);

    // Init WA setelah server berjalan
    await initWhatsApp();
  });
};

if (require.main === module) {
  startServer();
}
