import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import http from "http";
import { Server } from "socket.io";
import { socketService } from "./services/socket.service";
import { initDB, sequelize } from "./config/database";

const app = express();
app.set("trust proxy", 1); // Wajib untuk express-rate-limit di belakang Cloudflare Tunnel

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:5173"];
const server = http.createServer(app);
	const io = new Server(server, {
			  cors: {
			    origin: allowedOrigins,
			    methods: ["GET", "POST"],
			  },
			  // ─── Enterprise Stability (Polling-optimized) ───
			  pingTimeout: 120000,      // 2 min for long-polling
			  pingInterval: 30000,      // ping every 30s
			  connectTimeout: 30000,    // 30s initial connection
			  transports: ["polling"],  // Polling only — stable via nginx
			  allowEIO3: true,
			  maxHttpBufferSize: 1e6,
			});

	// 🔧 RE-EMIT QR & STATUS ke client yang baru connect
	// QR dihasilkan sebelum frontend connect → client baru gak terima event qr
	io.on("connection", (socket) => {
	  const qrCodes = socketService.getQRCodes();
	  for (const [storeId, qr] of Object.entries(qrCodes)) {
	    socket.emit("qr", { storeId, qr });
	  }
	});

// Security: Rate limiting — protect API from brute force
let rateLimit: any;
try {
  rateLimit = require("express-rate-limit");
} catch (_) {
  // Fallback if express-rate-limit not installed
  rateLimit = null;
}

// General API rate limiter: 3000 requests per 15 menit per IP (Ditingkatkan untuk real-time chat)
const apiLimiter = rateLimit
  ? rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 3000,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Terlalu banyak request. Coba lagi dalam 15 menit." },
    })
  : (req: any, res: any, next: any) => next();

// Auth endpoint rate limiter: 10 attempts per 15 menit
const authLimiter = rateLimit
  ? rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: "Terlalu banyak percobaan login. Coba lagi dalam 15 menit.",
      },
    })
  : (req: any, res: any, next: any) => next();

// Apply global middlewares
app.use(cors({ origin: allowedOrigins }));
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // allow frontend to load upload images from backend
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        scriptSrc: ["'self'", "https://static.cloudflareinsights.com"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: [
          "'self'",
          "https://static.cloudflareinsights.com",
          ...allowedOrigins,
        ],
      },
    },
  }),
);

// Apply rate limiters
app.use("/api/", apiLimiter);
app.use("/api/auth/login", authLimiter);
app.use(express.json({ limit: "10mb" })); // limit JSON body size

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  next();
});
app.use(express.urlencoded({ extended: true }));
app.set("io", io); // Buat io tersedia di req.app.get('io') — backward compat
socketService.init(io);

// Inject Socket.IO ke dashboard_service agar addToChatHistory bisa emit 'newMessage'
try {
  const dashboard = require("./services/dashboard_service");
  dashboard.setSocketIO(io);
} catch (e) {
  console.warn(
    "[Socket] dashboard_service.setSocketIO gagal:",
    (e as any).message,
  );
}

import analyticsRoutes from "./routes/analytics.routes";
import chatRoutes from "./routes/chat.routes";
import authRoutes from "./routes/auth.routes";
import settingsRoutes from "./routes/settings.routes";
import followupRoutes from "./routes/followup.routes";
import agentRoutes from "./routes/agent.routes";
import storesRoutes from "./routes/stores.routes";
import mediaRoutes from "./routes/media.routes";
import summariesRoutes from "./routes/summaries.routes";
import closingRoutes from "./routes/closing.routes";
import learningRoutes from "./routes/learning.routes";
import smartLabelRoutes from "./routes/smart-label.routes";
import botActivationRoutes from "./routes/bot-activation.routes";
import openaiBillingRoutes from "./routes/openai-billing.routes";
import xenditRoutes from "./routes/xendit.routes";
import mengantarRoutes from "./routes/mengantar.routes";
import scalevRoutes from "./routes/scalev.routes";
import { handleWebhook as xenditWebhook } from "./controllers/xendit.controller";
import { handleWebhook as scalevWebhook } from "./controllers/scalev.controller";
import { authenticateJWT } from "./middlewares/auth.middleware";
import errorHandler from "./middleware/errorHandler";
import path from "path";

// ─── Uploads Directory ───────────────────────────────────────────────────────
// Pakai DATA_DIR dari env agar sesuai dengan lokasi file asli (legacy data folder).
// Fallback ke dist/../data/uploads untuk dev lokal.
const UPLOADS_DIR_STATIC = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR, "uploads")
  : path.resolve(__dirname, "../data/uploads");

// Frontend dist directory (served in production)
const FRONTEND_DIST = process.env.FRONTEND_DIST
  ? path.resolve(process.env.FRONTEND_DIST)
  : path.resolve(__dirname, "../../frontend/dist");

// Public API
app.use("/api/auth", authRoutes);
// Scalev webhook (PUBLIC — Scalev sends payment callbacks here)
app.post("/api/scalev/webhook", scalevWebhook);
// Xendit webhook (PUBLIC — Xendit sends callbacks here, no JWT)
if (process.env.ENABLE_LEGACY_XENDIT === "true") {
  app.post("/api/xendit/webhook", xenditWebhook);
} else {
  app.post("/api/xendit/webhook", (req, res) => {
    res
      .status(410)
      .json({ error: "Xendit integration is disabled. Use Scalev payment." });
  });
}
app.use("/uploads", express.static(UPLOADS_DIR_STATIC));

// Protected API
app.use("/api/agents", authenticateJWT, agentRoutes);
app.use("/api/analytics", authenticateJWT, analyticsRoutes);
app.use("/api/chat", authenticateJWT, chatRoutes);
app.use("/api/settings", authenticateJWT, settingsRoutes);
app.use("/api/followups", authenticateJWT, followupRoutes);
app.use("/api/stores", authenticateJWT, storesRoutes);
app.use("/api/media", authenticateJWT, mediaRoutes);
app.use("/api/summaries", authenticateJWT, summariesRoutes);
app.use("/api/closing", authenticateJWT, closingRoutes);
app.use("/api/learning", authenticateJWT, learningRoutes);
app.use("/api/smart-labels", authenticateJWT, smartLabelRoutes);
app.use("/api/bot-activation", authenticateJWT, botActivationRoutes);
app.use("/api/openai/billing", authenticateJWT, openaiBillingRoutes);
// Mengantar shipping routes (protected)
app.use("/api/mengantar", authenticateJWT, mengantarRoutes);
// Scalev order management (protected except webhook above)
app.use("/api/scalev", authenticateJWT, scalevRoutes);

// Xendit Payment Gateway — disabled, use Scalev instead
if (process.env.ENABLE_LEGACY_XENDIT === "true") {
  app.use("/api/xendit", authenticateJWT, xenditRoutes);
} else {
  app.use("/api/xendit", (req, res) => {
    res
      .status(410)
      .json({ error: "Xendit integration is disabled. Use Scalev payment." });
  });
}

app.get("/health", async (req, res) => {
  try {
    await sequelize.authenticate();
    const { getQueueLength } = require("./services/dbWriteQueue");
    res.json({
      status: "ok",
      version: "2.0.0",
      database: "connected",
      dbWriteQueue: getQueueLength(),
    });
  } catch (e: any) {
    res.status(503).json({
      status: "error",
      version: "2.0.0",
      database: "disconnected",
      error: e.message,
    });
  }
});

// ======== Global Error Handler ========
app.use(errorHandler);

// ======== SPA Frontend Serving (production) ========
// Serve built React frontend for all non-API routes
import fs from "fs";
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  // SPA fallback — Express 5 requires named wildcard: /{*path}
  app.get("/{*path}", (req: any, res: any) => {
    if (
      req.path.startsWith("/api/") ||
      req.path.startsWith("/uploads/") ||
      req.path === "/health"
    ) {
      return res.status(404).json({ error: "Not found" });
    }
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
  console.log(`[Frontend] Serving static from ${FRONTEND_DIST}`);
} else {
  console.warn(
    `[Frontend] dist not found at ${FRONTEND_DIST} — run 'npm run build' in frontend/`,
  );
}

// ======== Socket.IO Connection Handlers ========

io.on("connection", (socket) => {
  console.log("[Socket] Client connected:", socket.id);

  // Re-emit current QR codes so newly connected client gets them instantly
  const currentQrs = socketService.getQRCodes();
  Object.entries(currentQrs).forEach(([storeId, qr]) => {
    socket.emit("qr", { storeId, qr });
  });

  // Allow client to join a store-specific room for targeted updates
  socket.on("joinStore", (storeId: string) => {
    socket.join(`store:${storeId}`);
    console.log(`[Socket] ${socket.id} joined store:${storeId}`);
  });

  socket.on("leaveStore", (storeId: string) => {
    socket.leave(`store:${storeId}`);
    console.log(`[Socket] ${socket.id} left store:${storeId}`);
  });

  socket.on("disconnect", () => {
    console.log("[Socket] Client disconnected:", socket.id);
  });
});

// ======== Backward-compatible re-exports (legacy JS services import these) ========
// All socket emissions are now centralized in socketService.
// These wrappers exist only for legacy code that imports emit* from app.ts directly.

export const emitQR = (storeId: string, qr: string) =>
  socketService.emitQR(storeId, qr);
export const emitReady = (storeId: string) => socketService.emitReady(storeId);
export const emitDisconnected = (storeId: string) =>
  socketService.emitDisconnected(storeId);
export const emitNewMessage = (storeId: string, msg: any) =>
  socketService.emitNewMessage(storeId, msg);
export const emitDashboardUpdate = () => socketService.emitDashboardUpdate();

const PORT = process.env.PORT || 3002;

// ─── Chromium Process Killer (OS-level — cross-platform) ─────────────────
/**
 * Membunuh SEMUA proses Chromium orphan yang tersisa dari crash/unclean shutdown.
 * Dipanggil saat startup DAN saat graceful shutdown.
 * Tanpa ini, Chromium akan pegang session folder → "browser is already running".
 */
const killOrphanedChromium = () => {
  try {
    const { execSync } = require("child_process");
    if (process.platform === "win32") {
      // Windows: bunuh chrome.exe beserta child process-nya
      const result = execSync("taskkill /F /IM chrome.exe /T 2>&1", {
        encoding: "utf-8",
        timeout: 10000,
        windowsHide: true,
      });
      if (result.includes("SUCCESS")) {
        console.log("[Server] Orphaned chrome.exe processes killed");
      }
    } else {
      // Linux/macOS
      execSync('pkill -f "chrome.*headless" 2>/dev/null || true', {
        timeout: 10000,
      });
      execSync('pkill -f "chromium.*headless" 2>/dev/null || true', {
        timeout: 10000,
      });
    }
  } catch (_) {
    // taskkill returns exit code 1 if no chrome.exe found — that's fine
  }
};

const initWhatsApp = async () => {
  try {
    const path = require("path");
    const fs = require("fs");
    const whatsappService = require("./whatsapp_service");
    const { Store } = require("./models");

    // === STARTUP CLEANUP ===
    // 1. Bunuh orphan Chromium dulu (biar ga ada "browser already running")
    killOrphanedChromium();
    // Tunggu OS release file handles
    await new Promise((r) => setTimeout(r, 3000));

    // 2. Hapus session-temp_* yang tersisa dari crash atau failed promotion
    const authDir = path.join(__dirname, "..", ".wwebjs_auth");
    if (fs.existsSync(authDir)) {
      const entries = fs.readdirSync(authDir);
      let cleanedCount = 0;
      for (const entry of entries) {
        if (entry.startsWith("session-temp_")) {
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

    // 3. Hapus file lock Chromium (SingletonLock dll) — jaga-jaga
    whatsappService.cleanupAllSessionLocks();

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
        await new Promise((r) => setTimeout(r, 15000));
      }
    }
  } catch (err: any) {
    console.error(`[WA] Global init error: ${err.message}`);
  }
};

// ======== Graceful Shutdown ========
// Urutan ketat: HTTP → Socket.IO → Scheduler → WA clients → Chromium kill → DB → exit
// PM2 kill_timeout: 90 detik (dikonfigurasi di ecosystem.config.js)
// Safety net: force exit setelah 80 detik kalau ada yang hang

let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  // Cegah double-shutdown (PM2 kadang kirim SIGINT + SIGTERM)
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[Server] Received ${signal} — starting graceful shutdown...`);

  // Safety net: force exit setelah 80 detik (PM2 kill_timeout=90)
  const forceExitTimer = setTimeout(() => {
    console.error("[Server] Shutdown timed out after 80s — forcing exit");
    process.exit(1);
  }, 80000);
  forceExitTimer.unref(); // Jangan block event loop

  try {
    // ── 1. Stop HTTP server (no more new connections) ───────────────────
    await new Promise<void>((resolve) => {
      server.close(() => {
        console.log("[Server] HTTP server closed");
        resolve();
      });
    });

    // ── 2. Stop Socket.IO ──────────────────────────────────────────────
    try {
      io.close();
      console.log("[Socket] IO server closed");
    } catch (_) {}

    // ── 3. Stop all schedulers & workers ────────────────────────────────
    const stopService = (name: string, stopFn: any) => {
      try {
        stopFn();
        console.log(`[Server] ${name} stopped`);
      } catch (_) {}
    };

    try {
      const waSyncScheduler = require("./services/wa_sync_scheduler.service");
      stopService("WaSyncScheduler", () => waSyncScheduler.stopScheduler());
    } catch (_) {}

    try {
      const {
        stopScheduler: stopOai,
      } = require("./services/openaiBilling.service");
      stopService("OpenAI Billing", stopOai);
    } catch (_) {}

    try {
      const { stopScheduler: stopXd } = require("./services/xendit.service");
      stopService("Xendit", stopXd);
    } catch (_) {}

    try {
      const { stopWorker } = require("./services/learning_worker");
      stopService("Learning Worker", stopWorker);
    } catch (_) {}

    // ── 4. Stop WA session monitoring & disconnect clients ─────────────
    try {
      const whatsappService = require("./whatsapp_service");

      // 4a. Stop health check monitoring
      if (typeof whatsappService.stopAllSessionMonitoring === "function") {
        whatsappService.stopAllSessionMonitoring();
        console.log("[Server] WA session monitoring stopped");
      }

      // 4b. Hentikan semua auto-reply yang sedang berjalan
      try {
        const { cancelAllActive } = require("./services/ai_reply_queue");
        cancelAllActive?.();
      } catch (_) {}

      // 4c. Destroy semua WA clients (puppeteer browser)
      if (typeof whatsappService.getClients === "function") {
        const clients = whatsappService.getClients();
        const destroyPromises: Promise<void>[] = [];

        for (const [storeId, client] of clients) {
          destroyPromises.push(
            (async () => {
              try {
                if (typeof client.destroy === "function") {
                  // Timeout per-client destroy: max 10 detik
                  await Promise.race([
                    client.destroy(),
                    new Promise((_, reject) =>
                      setTimeout(() => reject(new Error("timeout")), 10000),
                    ),
                  ]);
                  console.log("[WA] " + storeId + " browser closed");
                }
              } catch (e: any) {
                console.warn(
                  "[WA] " + storeId + " destroy warned: " + e.message,
                );
              }
            })(),
          );
        }

        if (destroyPromises.length > 0) {
          await Promise.allSettled(destroyPromises);
          console.log(`[WA] All ${destroyPromises.length} client(s) processed`);
        }
      }
    } catch (_) {}

    // ── 5. Kill all Chromium processes at OS level ────────────────────
    // Ini adalah SAFETY NET — memastikan tidak ada chrome.exe orphan
    killOrphanedChromium();
    // Tunggu OS cleanup
    await new Promise((r) => setTimeout(r, 2000));

    // ── 6. Close database connection ────────────────────────────────────
    try {
      // SQLite checkpoint manual sebelum tutup (flush WAL ke main DB)
      try {
        await sequelize.query("PRAGMA wal_checkpoint(TRUNCATE);");
      } catch (_) {}
      await sequelize.close();
      console.log("[Database] Connection closed");
    } catch (_) {}

    clearTimeout(forceExitTimer);
    console.log("[Server] Graceful shutdown complete ✅");
    process.exit(0);
  } catch (fatalError: any) {
    console.error(
      "[Server] Fatal shutdown error: " + (fatalError?.message || fatalError),
    );
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

export const startServer = async () => {
  await initDB();

  // Init backup service (auto-backup)
  try {
    const { initBackupService } = require("./services/backup_service");
    initBackupService();
    console.log("[Backup] Auto-backup service initialized");
  } catch (e: any) {
    console.warn("[Backup] Failed to init backup service:", e.message);
  }

  // Init follow-up scheduler
  try {
    const path = require("path");
    const { initFollowUpScheduler } = require("./services/followup.service");
    initFollowUpScheduler(io);
  } catch (e: any) {
    console.error("[FollowUp] Init Error:", e.message);
  }

  // Init OpenAI billing scheduler
  try {
    const { startScheduler } = require("./services/openaiBilling.service");
    startScheduler();
  } catch (e: any) {
    console.warn("[OpenAI Billing] Scheduler init:", e.message);
  }

  // Init Learning Worker (isolated background queue)
  try {
    const { startWorker } = require("./services/learning_worker");
    startWorker();
  } catch (e: any) {
    console.warn("[LearningWorker] Failed to start:", e.message);
  }

  // Init Xendit scheduler
  try {
    const { startScheduler } = require("./services/xendit.service");
    startScheduler();
  } catch (e: any) {
    console.warn("[Xendit] Scheduler init:", e.message);
  }

  server.listen(PORT, async () => {
    console.log(`[V2-Core] Server running on port ${PORT}`);

    // Init WA setelah server berjalan
    await initWhatsApp();

    // Background sync scheduler (staggered per-store)
    try {
      const waSyncScheduler = require("./services/wa_sync_scheduler.service");
      waSyncScheduler.startScheduler();
    } catch (e: any) {
      console.warn("[WaSyncScheduler] Failed to start:", e.message);
    }
  });
};

if (require.main === module) {
  startServer();
}
