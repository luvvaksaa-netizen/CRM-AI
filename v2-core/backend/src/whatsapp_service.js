const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const logger = require("./utils/logger");
const dashboard = require("./services/dashboard_service");
const { handleMessage } = require("./events/message_handler");
const { assertWaChatId } = require("./utils/wa_id");
const { shouldIgnoreIncomingChat } = require("./utils/contact_identity");
const wajsBridge = require("./services/wajs_bridge");
const waSessionMonitor = require("./services/wa_session_monitor.service");
const path = require("path");
const fs = require("fs");

const CHROMIUM_HEAP_MB = Number(process.env.WA_CHROMIUM_HEAP_MB || 512);
const RECENT_SYNC_CHAT_LIMIT = Number(process.env.WA_RECENT_SYNC_CHATS || 15);
const RECENT_SYNC_MSG_LIMIT = Number(process.env.WA_RECENT_SYNC_MESSAGES || 20);

// MULTI-CLIENT STORAGE
const clients = new Map();
const initializedClients = new Set(); // Mencegah double listener (Fixed Triple Reply Bug)
const readyClients = new Set();
const restartingClients = new Set();
const clientGenerations = new Map();
const tempClients = new Map();
const WA_SEND_READY_TIMEOUT_MS = Number(
  process.env.WA_SEND_READY_TIMEOUT_MS || 45000,
);

// DEBOUNCE: Mencegah 'ready' event firing 3x sekaligus (bug saat temp→permanent promotion)
// Kunci per-store dengan timestamp. Sync tidak diulang jika sudah berjalan < 30 detik lalu.
const readySyncLock = new Map(); // storeWaId -> lastSyncTimestamp

// IN-MEMORY BOT MESSAGE TRACKER
// Menyimpan ID pesan yang dikirim oleh BOT (bukan dari HP manual).
// Ini mencegah race condition di message_create event yang mendeteksi pesan bot sebagai pesan dari HP.
// Entry otomatis dihapus setelah 10 detik untuk mencegah memory leak.
const botSentMessageIds = new Set();

// ══════════════════════════════════════════════════════════
// FIX SUK-59 #3: SPAM PROTECTION — Per-contact cooldown + rate limiter
// ══════════════════════════════════════════════════════════

// Per-contact send cooldown tracker (minimum cooldown between sends to same contact)
const lastSendTimestamps = new Map(); // key: "storeWaId:contactId" -> Date.now()
const SEND_COOLDOWN_MS = Number(process.env.WA_SEND_COOLDOWN_MS || 1000); // default 1 detik (was 3s)

// Per-store rate limiter — raised for production (was 20/min → 120/min)
const storeSendCounters = new Map(); // key: storeWaId -> { count, windowStart }
const MAX_SENDS_PER_MINUTE = Number(process.env.WA_MAX_SENDS_PER_MINUTE || 120);
const SEND_RATE_WINDOW_MS = Number(process.env.WA_SEND_RATE_WINDOW_MS || 60000);

function checkSendThrottle(storeWaId, contactId) {
  // 1. Per-contact cooldown check
  const cooldownKey = `${storeWaId}:${contactId}`;
  const lastSend = lastSendTimestamps.get(cooldownKey);
  const now = Date.now();

  if (lastSend && now - lastSend < SEND_COOLDOWN_MS) {
    const waitMs = SEND_COOLDOWN_MS - (now - lastSend);
    logger.warn(
      `[${storeWaId}] ⚠️ Kirim ke ${contactId} DITAHAN — cooldown ${Math.round(waitMs)}ms lagi`,
    );
    return {
      allowed: false,
      reason: `Cooldown. Tunggu ${Math.round(waitMs / 1000)} detik lagi.`,
      waitMs,
    };
  }

  // 2. Per-store rate limiter check
  let counter = storeSendCounters.get(storeWaId);
  if (!counter || now - counter.windowStart > SEND_RATE_WINDOW_MS) {
    counter = { count: 0, windowStart: now };
    storeSendCounters.set(storeWaId, counter);
  }

  if (counter.count >= MAX_SENDS_PER_MINUTE) {
    const waitMs = SEND_RATE_WINDOW_MS - (now - counter.windowStart);
    logger.warn(
      `[${storeWaId}] ⚠️ Rate limit tercapai (${counter.count}/${MAX_SENDS_PER_MINUTE}/menit)`,
    );
    return {
      allowed: false,
      reason: `Rate limit tercapai. Tunggu ${Math.round(waitMs / 1000)} detik.`,
      waitMs,
    };
  }

  // Allow the send
  counter.count++;
  lastSendTimestamps.set(cooldownKey, now);
  return { allowed: true };
}

function resetSendThrottleForContact(storeWaId, contactId) {
  lastSendTimestamps.delete(`${storeWaId}:${contactId}`);
}

function trackBotSentMessage(msgId) {
  if (!msgId) return;
  botSentMessageIds.add(msgId);
  setTimeout(() => botSentMessageIds.delete(msgId), 10000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDetachedFrameError(error) {
  return /detached Frame|Execution context was destroyed|Target closed|Session closed|Cannot find context|Protocol error/i.test(
    cleanErrorMessage(error),
  );
}

/**
 * Mendapatkan semua Client yang aktif.
 */
function getClients() {
  return clients;
}

function getActiveClient(storeWaId) {
  const client = clients.get(storeWaId);
  if (!client) throw new Error(`Client [${storeWaId}] tidak aktif!`);
  return client;
}

function isCurrentClient(storeWaId, client) {
  return Boolean(client && clients.get(storeWaId) === client);
}

function isPuppeteerPageUsable(client) {
  try {
    return Boolean(client?.pupPage && !client.pupPage.isClosed?.());
  } catch (_) {
    return false;
  }
}

function cleanErrorMessage(error) {
  return String(error?.message || error || "Unknown error").split("\n")[0];
}

async function getStateWithTimeout(client, timeoutMs = 3000) {
  return Promise.race([
    client.getState(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Timeout menunggu state WhatsApp")),
        timeoutMs,
      ),
    ),
  ]);
}

async function waitForActiveClient(
  storeWaId,
  timeoutMs = WA_SEND_READY_TIMEOUT_MS,
) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    const client = clients.get(storeWaId);
    if (!client) {
      lastError = new Error(`Client [${storeWaId}] belum aktif`);
      await sleep(500);
      continue;
    }

    if (readyClients.has(storeWaId) && isPuppeteerPageUsable(client)) {
      return client;
    }

    if (isPuppeteerPageUsable(client)) {
      try {
        const state = await getStateWithTimeout(client, 3000);
        if (state === "CONNECTED") {
          readyClients.add(storeWaId);
          return client;
        }
        lastError = new Error(
          `WhatsApp state belum siap: ${state || "unknown"}`,
        );
      } catch (error) {
        lastError = error;
        if (isDetachedFrameError(error)) readyClients.delete(storeWaId);
      }
    }

    await sleep(750);
  }

  throw new Error(
    `Client [${storeWaId}] belum siap kirim setelah ${Math.round(timeoutMs / 1000)} detik: ${cleanErrorMessage(lastError)}`,
  );
}

function getMessageId(message) {
  return (
    message?.id?._serialized || message?.id?.id || message?.quotedMsgId || ""
  );
}

function clipQuoteBody(value, maxLength = 500) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function quoteContextFromMessage(message, fallbackSender = "") {
  return {
    quoted_message_id: getMessageId(message),
    quoted_body: clipQuoteBody(message?.body || message?.caption || ""),
    quoted_from_me: Boolean(message?.fromMe),
    quoted_sender_name:
      fallbackSender || (message?.fromMe ? "CS/Admin" : "Pelanggan"),
  };
}

async function extractQuotedContext(message, storeWaId) {
  try {
    const directQuotedId =
      message?.quotedMsgId ||
      message?._data?.quotedMsg?.id?._serialized ||
      message?._data?.quotedMsgId?._serialized ||
      message?._data?.quotedStanzaID;
    const directQuotedBody =
      message?.quotedBody ||
      message?._data?.quotedMsg?.body ||
      message?._data?.quotedMsg?.caption ||
      "";

    if (
      message?.hasQuotedMsg &&
      typeof message.getQuotedMessage === "function"
    ) {
      const quoted = await message.getQuotedMessage();
      if (quoted)
        return quoteContextFromMessage(
          quoted,
          quoted.fromMe ? "CS/Admin" : "Pelanggan",
        );
    }

    if (directQuotedId || directQuotedBody) {
      return {
        quoted_message_id: directQuotedId || null,
        quoted_body: clipQuoteBody(directQuotedBody),
        quoted_from_me: message?.quotedFromMe ?? null,
        quoted_sender_name: message?.quotedSenderName || null,
      };
    }
  } catch (error) {
    logger.warn(
      `[${storeWaId}] Gagal membaca konteks quoted reply: ${error.message}`,
    );
  }
  return {};
}

async function getChatsWithRetry(client, attempts = 3, delayMs = 5000) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // Coba pakai WA-JS dulu yang lebih stabil dan cepat
      if (client.__wajsReady) {
        try {
          return await wajsBridge.getChats(
            client,
            client.options?.authStrategy?.clientId || "default",
          );
        } catch (e) {
          logger.warn(`WA-JS getChats gagal, fallback ke WWebJS: ${e.message}`);
        }
      }
      return await client.getChats();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * Tarik pesan terbaru dari N chat aktif ke database (anti-duplikat).
 * Dipakai saat ready, background scheduler, dan recovery.
 */
async function syncRecentChatsFromWa(storeWaId, options = {}) {
  const client = clients.get(storeWaId);
  if (!client || !readyClients.has(storeWaId)) {
    throw new Error(`Client [${storeWaId}] belum siap untuk sync`);
  }

  const source = options.source || "manual";
  const skipDebounce = options.skipDebounce === true;

  if (!skipDebounce) {
    const now = Date.now();
    const lastSync = readySyncLock.get(storeWaId) || 0;
    if (now - lastSync < 30000) {
      logger.info(`[${storeWaId}] Sync ${source} dilewati (debounce 30s)`);
      return { synced: 0, skipped: true };
    }
    readySyncLock.set(storeWaId, now);
  }

  if (!client.__wajsReady) {
    await wajsBridge.injectWajs(client, storeWaId);
    await sleep(2000);
  }

  const { ChatMessage } = require("./models/index");
  const chats = await getChatsWithRetry(client);
  const recentChats = chats
    .filter((c) => !shouldIgnoreIncomingChat(c.id._serialized))
    .slice(0, RECENT_SYNC_CHAT_LIMIT);

  let totalSynced = 0;
  for (const chat of recentChats) {
    try {
      let messages = [];
      const chatId = chat.id._serialized || chat.id;

      if (client.__wajsReady) {
        try {
          messages = await wajsBridge.getMessages(
            client,
            chatId,
            RECENT_SYNC_MSG_LIMIT,
            storeWaId,
          );
        } catch (wajsErr) {
          logger.info(
            `[${storeWaId}] WA-JS getMessages fallback untuk ${chatId}: ${cleanErrorMessage(wajsErr)}`,
          );
        }
      }

      if (!messages || messages.length === 0) {
        if (typeof chat.fetchMessages === "function") {
          messages = await chat.fetchMessages({ limit: RECENT_SYNC_MSG_LIMIT });
        }
      }

      if (!messages || messages.length === 0) continue;

      for (const msg of messages) {
        const msgId = msg.id?._serialized || msg.id?.id;
        if (!msgId) continue;

        const exists = await ChatMessage.findOne({
          where: { wa_message_id: msgId },
        });
        if (exists) continue;

        await handleMessage(msg, storeWaId, false);
        totalSynced++;
        waSessionMonitor.recordActivity(storeWaId, "sync");
      }

      if (chat.unreadCount > 0 && typeof chat.sendSeen === "function") {
        await chat.sendSeen();
      }
    } catch (chatErr) {
      logger.info(
        `[${storeWaId}] Skip sync chat [${chat.id._serialized}]: ${cleanErrorMessage(chatErr)}`,
      );
    }
  }

  if (totalSynced > 0) {
    logger.success(`[${storeWaId}] Sync ${source}: ${totalSynced} pesan baru`);
  }

  return { synced: totalSynced, skipped: false };
}

function beginClientSession(storeWaId) {
  waSessionMonitor.startMonitoring(storeWaId);
}

function stopClientSession(storeWaId) {
  waSessionMonitor.stopMonitoring(storeWaId);
}

function stopAllSessionMonitoring() {
  waSessionMonitor.stopAllMonitoring();
}

/**
 * Membersihkan semua Singleton Lock Files per-ClientId.
 * Mencegah error "profile already in use" saat container restart di Railway.
 */
/**
 * Clean up stale WWebJS sessions that don't have a valid WhatsApp auth cookie.
 * Stale sessions (from interrupted runs) prevent QR generation on restart.
 */
function cleanupStaleSessions() {
  const authDir = path.join(__dirname, "..", ".wwebjs_auth");
  if (!fs.existsSync(authDir)) return;

  const entries = fs.readdirSync(authDir);
  let cleanedCount = 0;
  for (const entry of entries) {
    if (!entry.startsWith("session-")) continue;
    
    // 🔧 JANGAN hapus session yang client-nya sedang aktif (misal: sedang QR scan)
    const clientId = entry.replace("session-", "");
    if (clients.has(clientId)) {
      logger.info(`[Cleanup] Session ${entry} dilewati — client aktif`);
      continue;
    }
    
    const sessionDir = path.join(authDir, entry);
    const cookiesPathOld = path.join(sessionDir, "Default", "Cookies");
    const cookiesPathNew = path.join(
      sessionDir,
      "Default",
      "Network",
      "Cookies",
    );

    // If session folder exists but has NO Cookies file in either location, it's stale
    if (
      fs.existsSync(sessionDir) &&
      !fs.existsSync(cookiesPathOld) &&
      !fs.existsSync(cookiesPathNew)
    ) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        cleanedCount++;
        logger.info(`[Cleanup] Stale session dihapus: ${entry}`);
      } catch (e) {
        logger.warn(`[Cleanup] Gagal hapus ${entry}: ${e.message}`);
      }
    }
  }
  if (cleanedCount > 0) {
    logger.info(`[Cleanup] ${cleanedCount} stale session(s) dibersihkan`);
  }
}

function cleanupSessionLocks(clientId) {
  const baseWwebjsDir = path.join(process.cwd(), ".wwebjs_auth");
  const sessionDir = path.join(baseWwebjsDir, `session-${clientId}`);

  // Semua file lock yang perlu dihapus (Chromium stores these as symlinks on mac/linux, files on windows)
  const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket"];

  lockFiles.forEach((lockName) => {
    const lockFile = path.join(sessionDir, lockName);
    try {
      fs.rmSync(lockFile, { force: true });
    } catch (e) {
      /* ignore */
    }
  });

  // Hapus Cache Chromium yang membengkak (mencegah disk & memory bloating)
  const cacheDirs = [
    path.join(sessionDir, "Default", "Cache"),
    path.join(sessionDir, "Default", "Code Cache"),
    path.join(sessionDir, "Default", "Service Worker", "CacheStorage"),
  ];

  cacheDirs.forEach((dir) => {
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      /* ignore */
    }
  });
}

/**
 * Bersihkan file lock dari SEMUA session folder.
 * Dipanggil saat startup (setelah killOrphanedChromium) untuk memastikan
 * tidak ada sisa lock dari shutdown sebelumnya.
 */
function cleanupAllSessionLocks() {
  const baseWwebjsDir = path.join(process.cwd(), ".wwebjs_auth");
  if (!fs.existsSync(baseWwebjsDir)) return;

  const entries = fs.readdirSync(baseWwebjsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("session-")) {
      cleanupSessionLocks(entry.name.replace("session-", ""));
    }
  }
}

/**
 * Inisialisasi WhatsApp Client untuk Toko tertentu.
 * @param {string} storeWaId - Unik identifier dari tabel Store.
 */
function createWhatsAppClient(storeWaId) {
  // CEK DUPLIKAT: Jangan buat client baru jika ID sudah ada & aktif
  if (clients.has(storeWaId)) {
    logger.warn(`[${storeWaId}] Client sudah ada. Menggunakan yang lama.`);
    return clients.get(storeWaId);
  }

  // Auto-cleanup stale sessions before creating new client
  cleanupStaleSessions();

  cleanupSessionLocks(storeWaId);

  logger.info(`[${storeWaId}] Menyiapkan Browser & Sesi...`);
  waSessionMonitor.markStatus(storeWaId, "initializing");
  dashboard.updateWAStatus(storeWaId, "initializing");

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: storeWaId,
    }),
    puppeteer: {
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        // === MEMORY OPTIMIZATION (Production Grade) ===
        "--disable-extensions",
        "--disable-translate",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-default-apps",
        "--disable-features=TranslateUI",
        "--no-first-run",
        "--disable-renderer-backgrounding", // Hemat CPU saat tab tidak aktif
        "--disable-backgrounding-occluded-windows",
        `--js-flags=--max-old-space-size=${CHROMIUM_HEAP_MB}`, // Per-browser heap
        "--disable-features=IsolateSandboxedIframes",
      ],
      headless: "new",  // Puppeteer 24.x requires 'new' mode
      handleSIGINT: false,
      timeout: 180000, // 180 detik timeout launch
    },
  });

  const generation = (clientGenerations.get(storeWaId) || 0) + 1;
  clientGenerations.set(storeWaId, generation);
  client.__storeWaId = storeWaId;
  client.__waAiGeneration = generation;
  readyClients.delete(storeWaId);
  clients.set(storeWaId, client);
  return client;
}

/**
 * Menyiapkan Event Listeners untuk Client tertentu.
 * Mencegah duplikasi listener yang menyebabkan bot membalas berkali-kali.
 */
function setupEventListeners(client, storeWaId, io) {
  // PROTEKSI: Jika client sudah pernah disetup (event on), jangan diulang!
  if (initializedClients.has(storeWaId)) {
    logger.warn(`[${storeWaId}] Event listeners sudah terpasang. Skip setup.`);
    return;
  }

  client.on("qr", (qr) => {
    logger.bot(`[${storeWaId}] Scan QR Code di Dashboard UI`);
    // Emit via v2-core Socket.IO if available, else fallback to legacy dashboard
    if (io) {
      io.emit("qr", { storeId: storeWaId, qr });
    }
    // Also store via socketService for reconnect persistence
    try {
      const { socketService } = require("./services/socket.service");
      socketService.emitQR(storeWaId, qr);
    } catch (e) {}
    dashboard.emitQRSpec(storeWaId, qr);
    dashboard.updateWAStatus(storeWaId, "needs_scan");
  });

  // 🔧 IDEMPOTENT + WATCHDOG: authenticated bisa fire multiple times dari whatsapp-web.js
  // Jika ready tidak muncul dalam 45 detik setelah authenticated, restart client
  let authFiredForThisClient = false;
  let readyWatchdog = null;
  client.on("authenticated", () => {
    if (authFiredForThisClient) {
      // Re-fire authenticated setelah navigation (execution context destroyed)
      // Reset watchdog — perpanjang grace period
      if (readyWatchdog) clearTimeout(readyWatchdog);
      readyWatchdog = setTimeout(() => {
        logger.warn(`[${storeWaId}] ⚠️ Authenticated tapi ready tidak muncul dalam 45s — restart`);
        restartClientRuntime(storeWaId, "ready-timeout").catch(() => {});
      }, 45000);
      return;
    }
    authFiredForThisClient = true;
    logger.success(`[${storeWaId}] Sesi WhatsApp Terautentikasi.`);
    dashboard.updateWAStatus(storeWaId, "authenticating");
    try {
      const { socketService } = require("./services/socket.service");
      socketService.emitStatusUpdate(storeWaId, "authenticating");
    } catch (_) {}
    // Watchdog: jika ready tidak muncul dalam 45 detik, restart
    readyWatchdog = setTimeout(() => {
      logger.warn(`[${storeWaId}] ⚠️ Authenticated tapi ready tidak muncul dalam 45s — restart`);
      restartClientRuntime(storeWaId, "ready-timeout").catch(() => {});
    }, 45000);
  });

  // 🔧 loading_screen: deteksi WhatsApp Web loading
  client.on("loading_screen", (percent, message) => {
    logger.info(`[${storeWaId}] 📊 WhatsApp loading: ${percent}% - ${message}`);
  });

  // P0 FIX: auth_failure handler — trigger QR re-scan saat session dihapus/logout
  client.on("auth_failure", async (msg) => {
    logger.error(`[${storeWaId}] Auth failure: ${msg}`);
    await restartClientRuntime(storeWaId, "auth_failure");
  });

  client.on("ready", async () => {
    // Clear ready watchdog
    if (readyWatchdog) { clearTimeout(readyWatchdog); readyWatchdog = null; }
    logger.success(`[${storeWaId}] WhatsApp SIAP DIGUNAKAN! ✅`);
    readyClients.add(storeWaId);
    waSessionMonitor.recordActivity(storeWaId, "ready");
    waSessionMonitor.markStatus(storeWaId, "ready");

    const { socketService } = require("./services/socket.service");
    if (io) {
      io.emit("ready", { storeId: storeWaId });
    }
    socketService.emitReady(storeWaId);
    // Bersihkan QR dari memory — sudah tidak diperlukan
    socketService.clearQR(storeWaId);
    dashboard.updateWAStatus(storeWaId, "ready");

    const now = Date.now();
    const lastReady = readySyncLock.get(storeWaId) || 0;
    const isFirstReadyInWindow = now - lastReady >= 30000;
    if (isFirstReadyInWindow) {
      readySyncLock.set(storeWaId, now);
      socketService.emitBotReconnect(storeWaId);
    }

    // Simpan nomor bot secara persisten agar muncul di UI
    if (client.info && client.info.wid && client.info.wid.user) {
      dashboard
        .updateStorePhone(storeWaId, client.info.wid.user)
        .catch(() => {});
    }

    beginClientSession(storeWaId);

    if (isFirstReadyInWindow) {
      try {
        await syncRecentChatsFromWa(storeWaId, {
          source: "ready",
          skipDebounce: true,
        });
      } catch (e) {
        logger.warn(
          `[${storeWaId}] Sinkronisasi chat dilewati: ${cleanErrorMessage(e)}`,
        );
      }
    }
  });

  // Pesan MASUK dari customer (SKIP pesan dari diri sendiri untuk mencegah duplikat)
  client.on("message", async (message) => {
    if (message.isStatus || message.fromMe || shouldIgnoreIncomingChat(message.from)) return;
    waSessionMonitor.recordActivity(storeWaId, "message");
    await handleMessage(message, storeWaId);
  });

  // ══════════════════════════════════════════════════════════════════
  // SINKRONISASI PESAN KELUAR DARI HP (message_create)
  // Menangkap pesan yang dikirim LANGSUNG dari HP (bukan dari bot/dashboard).
  // Penting agar riwayat percakapan di CRM selalu lengkap & konsisten dengan HP.
  // ══════════════════════════════════════════════════════════════════
  client.on("message_create", async (message) => {
    // Hanya proses pesan dari sisi kita (isMe = true) yang dikirim dari HP, bukan dari bot
    if (!message.fromMe) return;
    if (message.isStatus) return;
    if (shouldIgnoreIncomingChat(message.to)) return;

    const msgId = message.id?._serialized || message.id?.id;
    if (!msgId) return;

    // Berikan delay singkat (1.5 detik) agar jika ini pesan BOT,
    // _logBotReply punya waktu untuk mendaftarkan ID ke in-memory tracker (botSentMessageIds).
    // Ini menghindari race condition dimana AI tercatat sebagai CS Manual.
    setTimeout(async () => {
      // PALING CEPAT: Cek in-memory set dulu (menghindari race condition dengan DB write)
      if (botSentMessageIds.has(msgId)) return;

      // Cek apakah pesan ini sudah dicatat (mungkin sudah dicatat oleh bot sendiri via _logBotReply)
      try {
        const { ChatMessage } = require("./models/index");
        const exists = await ChatMessage.findOne({
          where: { wa_message_id: msgId },
        });
        if (exists) return; // Sudah ada, skip

        const body = message.body || "";
        if (!body && !message.hasMedia) return;
        const quotedContext = await extractQuotedContext(message, storeWaId);

        // Log pesan keluar dari HP ke dashboard (bukan AI, tapi CS Manual dari HP)
        await dashboard.addToChatHistory(storeWaId, {
          id: msgId,
          from: message.to,
          body: body || "(Media dari HP)",
          isMe: true,
          timestamp: new Date(message.timestamp * 1000),
          sender_name: "CS (dari HP)",
          ...quotedContext,
        });
        // Ambil info kontak untuk log yang lebih terbaca
        let logDisplay = `[${message.to}]`;
        try {
          // Untuk pesan dari HP, getContact() akan mereturn identitas diri kita sendiri.
          // Oleh karena itu, kita fetch contact tujuan dengan getContactById.
          const recipientContact = await message.client.getContactById(
            message.to,
          );
          const { buildContactIdentity } = require("./utils/contact_identity");
          const identity = buildContactIdentity(message.to, recipientContact);
          logDisplay = `[${identity.displayName || ""}${identity.phone ? " | +" + identity.phone : ""}] (${message.to})`;
        } catch (e) {
          /* ignore */
        }

        logger.info(
          `[${storeWaId}] Pesan keluar dari HP tercatat: ke ${logDisplay}`,
        );

        // ── CS MANUAL AWARENESS (background, non-blocking) ──────────────────
        // 1. Cancel follow-up pending: CS sudah handle manual, tidak perlu bot follow-up
        try {
          const {
            cancelPendingFollowUps,
          } = require("./services/followup.service");
          cancelPendingFollowUps(
            storeWaId,
            message.to,
            "CS membalas manual dari HP",
          ).catch(() => {});
        } catch (_) {
          /* non-critical */
        }

        // 2. Trigger background summary update (debounced 30 detik)
        // Agar ketika bot ON kembali, AI tau CS sudah balas sampai mana
        try {
          const {
            triggerCsManualSummaryUpdate,
          } = require("./services/bot_activation_service");
          triggerCsManualSummaryUpdate(storeWaId, message.to, "CS (dari HP)");
        } catch (_) {
          /* non-critical */
        }
      } catch (e) {
        // Non-critical
      }
    }, 1500); // Tutup setTimeout
  });

  // ─── Read Receipts (message_ack) ──────────────────────────────
  // Tangkap status centang WhatsApp: 0=pending, 1=server, 2=delivered, 3=read
  client.on("message_ack", async (msg, ack) => {
    try {
      const msgId = msg?.id?._serialized || msg?.id?.id;
      if (!msgId) return;
      // Update is_read di database
      const { ChatMessage } = require("./models/index");
      if (ack >= 2) {
        await ChatMessage.update(
          { is_read: ack >= 3 },
          { where: { wa_message_id: msgId } },
        ).catch(() => {});
        // Emit chatRead ke frontend agar centang update real-time
        const contactId = msg?.to || msg?.from || "";
        if (io && contactId) {
          io.emit("chatRead", { storeId: storeWaId, contactId, ack });
        }
      }
    } catch (e) {
      // Non-critical — jangan spam log
    }
  });

  // ─── Customer Typing Indicator (change_state) ─────────────────
  client.on("change_state", async (state) => {
    try {
      // state: { id: contactId, type: 'chat', isGroup: false, timestamp, ... }
      // WhatsApp sends change_state for: composing, paused, recording, etc.
      const contactId = state?.id?._serialized || state?.id;
      if (!contactId || state?.isGroup) return;
      const isTyping = state?.isComposing === true;
      if (io) {
        io.emit("typingStatus", {
          storeId: storeWaId,
          contactId,
          isTyping,
        });
      }
    } catch (e) {
      // Non-critical
    }
  });

  // P0 FIX: disconnected handler dengan auto-reconnect + retry logic
  // Max 3x reconnect attempt, delay 30 detik antar attempt.
  // Kalau semua gagal, baru cleanup + notifikasi kritis ke admin.
  client.on("disconnected", async (reason) => {
    logger.error(`[${storeWaId}] WhatsApp Terputus: ${reason}`);
    waSessionMonitor.markStatus(storeWaId, "disconnected");
    if (io) {
      io.emit("disconnected", { storeId: storeWaId });
    }
    try {
      const { socketService } = require("./services/socket.service");
      socketService.emitDisconnected(storeWaId);
    } catch (_) {}
	    dashboard.updateWAStatus(storeWaId, "disconnected");
	    readyClients.delete(storeWaId);

	    // 🔧 LOGOUT saat initial pairing = WhatsApp reject scan. Jangan restart agresif!
	    if (reason === "LOGOUT") {
	      logger.warn(`[${storeWaId}] LOGOUT saat pairing — regenerate QR tanpa hapus session...`);
	      await sleep(8000);
	      try {
	        const oldClient = clients.get(storeWaId);
	        if (oldClient) {
	          try { await oldClient.destroy().catch(() => {}); } catch (_) {}
	          clients.delete(storeWaId);
	          initializedClients.delete(storeWaId);
	        }
	        const newClient = createWhatsAppClient(storeWaId);
	        setupEventListeners(newClient, storeWaId, io);
	        await newClient.initialize();
	        logger.info(`[${storeWaId}] QR regenerated — scan ulang di Dashboard`);
	      } catch (e) {
	        logger.error(`[${storeWaId}] Regenerate QR gagal: ${cleanErrorMessage(e)}`);
	      }
	      return;
	    }

	    // Cek apakah restart sudah di-trigger oleh auth_failure
	    if (restartingClients.has(storeWaId)) {
	      logger.info(
	        `[${storeWaId}] Restart already in progress (likely auth_failure), skipping retry`,
	      );
	      return;
	    }

	    const MAX_RECONNECT_ATTEMPTS = 3;
    const RECONNECT_DELAY_MS = 30000; // 30 detik

    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      logger.info(
        `[${storeWaId}] 🔄 Auto-reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS}...`,
      );
      try {
        await restartClientRuntime(storeWaId, "disconnected", true);
        logger.success(
          `[${storeWaId}] ✅ Auto-reconnect berhasil pada attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS}`,
        );
        return; // Berhasil — jangan cleanup
      } catch (e) {
        logger.error(
          `[${storeWaId}] ❌ Auto-reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS} gagal: ${cleanErrorMessage(e)}`,
        );
        if (attempt < MAX_RECONNECT_ATTEMPTS) {
          logger.info(
            `[${storeWaId}] Menunggu ${RECONNECT_DELAY_MS / 1000}s sebelum attempt berikutnya...`,
          );
          await sleep(RECONNECT_DELAY_MS);
        }
      }
    }

    // Semua attempt gagal — cleanup + notifikasi kritis
    logger.error(
      `[${storeWaId}] 🚨 SEMUA AUTO-RECONNECT GAGAL (${MAX_RECONNECT_ATTEMPTS}x). Bot di-cleanup. Perlu intervensi manual!`,
    );
    clients.delete(storeWaId);
    initializedClients.delete(storeWaId);
  });

  // ══════════════════════════════════════════════════════════════════
  // SINKRONISASI: PESAN DIHAPUS (message_revoke)
  // Ketika customer/CS menghapus pesan dari HP, database dan dashboard
  // kita ikut diperbarui secara real-time.
  // ══════════════════════════════════════════════════════════════════
  client.on("message_revoke_everyone", async (revokedMsg, oldMsg) => {
    const msgId = revokedMsg?.id?._serialized || revokedMsg?.id?.id;
    if (!msgId) return;
    try {
      const { ChatMessage } = require("./models/index");
      const deleted = await ChatMessage.destroy({
        where: { wa_message_id: msgId },
      }).catch(() => 0);
      if (deleted > 0) {
        // Beritahu frontend via Socket.IO agar UI langsung update
        dashboard.emitMessageRevoked(
          storeWaId,
          msgId,
          revokedMsg?.from || revokedMsg?.to,
        );
        logger.info(
          `[${storeWaId}] Pesan [${msgId}] dihapus customer → dihapus dari CRM.`,
        );
      }
    } catch (e) {
      // Non-critical: DB deletion failure
    }
  });

  // Tandai sebagai sudah diinisialisasi
  initializedClients.add(storeWaId);
}

/**
 * Mengirim pesan manual dari Dashboard melalui Client yang spesifik.
 * @param {string} storeWaId - Nomor toko yang mengirim.
 */
async function sendManualMessage(storeWaId, to, body, options = {}) {
  // ═══ FIX SUK-59 #3: Throttle check ═══
  const throttle = checkSendThrottle(storeWaId, to);
  if (!throttle.allowed) {
    throw new Error(throttle.reason);
  }

  const client = await waitForActiveClient(storeWaId);
  if (!client || typeof client.sendMessage !== "function") {
    throw new Error(
      `Client [${storeWaId}] tidak tersedia atau tidak memiliki sendMessage.`,
    );
  }
  const targetChatId = assertWaChatId(to);
  const quotedMessageId = String(
    options.quotedMessageId || options.quoted_message_id || "",
  ).trim();

  try {
    const sendOptions = quotedMessageId
      ? { quotedMessageId, ignoreQuoteErrors: true }
      : {};
    let msg;
    try {
      msg = await client.sendMessage(targetChatId, body, sendOptions);
    } catch (sendErr) {
      // FIX: jika quoted message tidak ada di memori WA session (misal session baru),
      // whatsapp-web.js melempar "getChat of undefined". Fallback: kirim tanpa quote.
      if (
        quotedMessageId &&
        /getChat|undefined/i.test(sendErr?.message || "")
      ) {
        logger.warn(
          `[${storeWaId}] Quoted msg tidak ditemukan di session, kirim tanpa quote.`,
        );
        msg = await client.sendMessage(targetChatId, body, {});
      } else {
        throw sendErr;
      }
    }
    const msgId = msg.id?._serialized || msg.id?.id;
    trackBotSentMessage(msgId);

    // Log ke Dashboard UI & DB dengan Store ID yang benar
    await dashboard.addToChatHistory(storeWaId, {
      id: msgId,
      from: targetChatId,
      body: body,
      isMe: true,
      sender_name: "CS Manual",
      quoted_message_id: quotedMessageId || null,
      quoted_body: clipQuoteBody(
        options.quotedBody || options.quoted_body || "",
      ),
      quoted_from_me: options.quotedFromMe ?? options.quoted_from_me ?? null,
      quoted_sender_name:
        options.quotedSenderName || options.quoted_sender_name || null,
    });

    // TAHAP 3: Auto-Pause AI
    const { pauseBotForContact } = require("./events/message_handler");
    pauseBotForContact(storeWaId, targetChatId);

    logger.info(
      `[${storeWaId}] Pesan Manual dikirim ke [${targetChatId}]. AI otomatis ditidurkan untuk kontak ini.`,
    );
    return true;
  } catch (error) {
    logger.error(`[${storeWaId}] Gagal kirim manual: ${error.message}`);
    throw error;
  }
}

/**
 * Mengirim gambar/video (katalog) secara manual dari Dashboard.
 */
async function sendManualMedia(storeWaId, to, mediaAsset) {
  // ═══ FIX SUK-59 #3: Throttle check ═══
  const throttle = checkSendThrottle(storeWaId, to);
  if (!throttle.allowed) {
    throw new Error(throttle.reason);
  }

  const client = await waitForActiveClient(storeWaId);
  const targetChatId = assertWaChatId(to);

  try {
    const { MessageMedia } = require("whatsapp-web.js");
    const { UPLOADS_DIR } = require("./config");
    const path = require("path");
    const fs = require("fs");

    let mediaPath = path.join(UPLOADS_DIR, path.basename(mediaAsset.filename));
    if (!fs.existsSync(mediaPath))
      throw new Error("File media fisik tidak ditemukan.");
    if (String(mediaAsset.type || "").toLowerCase() === "video") {
      const { optimizeVideoForWhatsApp } = require("./services/media.service");
      mediaPath = await optimizeVideoForWhatsApp(mediaAsset, mediaPath);
    }

    const mediaMsg = MessageMedia.fromFilePath(mediaPath);
    const caption = mediaAsset.description || mediaAsset.label || "";
    const msg = await client.sendMessage(targetChatId, mediaMsg, { caption });
    const msgId = msg.id?._serialized || msg.id?.id;
    trackBotSentMessage(msgId);

    // Tampilkan sebagai HTML thumbnail di Dashboard
    const fileExt = mediaPath.split(".").pop().toLowerCase();
    const tag = ["mp4", "mov", "avi"].includes(fileExt) ? "[VIDEO" : "[MEDIA";
    const logBody = `${tag}:/uploads/${path.basename(mediaPath)}] ${caption}`;

    await dashboard.addToChatHistory(storeWaId, {
      id: msgId,
      from: targetChatId,
      body: logBody,
      isMe: true,
      sender_name: "CS Manual",
    });

    // TAHAP 3: Auto-Pause AI jika kirim media
    const { pauseBotForContact } = require("./events/message_handler");
    pauseBotForContact(storeWaId, targetChatId);

    logger.info(
      `[${storeWaId}] Media Manual [${mediaAsset.label}] dikirim ke [${targetChatId}]. AI dipause.`,
    );
    return true;
  } catch (error) {
    logger.error(`[${storeWaId}] Gagal kirim media manual: ${error.message}`);
    throw error;
  }
}

/**
 * Mengirim follow-up otomatis ke customer TANPA pause AI.
 * Berbeda dengan sendManualMessage yang otomatis pause bot.
 */
async function sendFollowUpMessage(
  storeWaId,
  contactId,
  body,
  mediaAsset = null,
) {
  const client = await waitForActiveClient(storeWaId);
  const targetChatId = assertWaChatId(contactId);

  // Retry sekali untuk transient timeout (Runtime.callFunctionOn timed out, dll)
  const MAX_SEND_RETRIES = 2;
  const RETRY_DELAY_MS = 3000;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_SEND_RETRIES; attempt++) {
    try {
      // Kirim media jika ada
      if (mediaAsset) {
        const { MessageMedia } = require("whatsapp-web.js");
        const { UPLOADS_DIR } = require("./config");
        let mediaPath = path.join(
          UPLOADS_DIR,
          path.basename(mediaAsset.filename),
        );

        if (fs.existsSync(mediaPath)) {
          if (String(mediaAsset.type || "").toLowerCase() === "video") {
            const {
              optimizeVideoForWhatsApp,
            } = require("./services/media.service");
            mediaPath = await optimizeVideoForWhatsApp(mediaAsset, mediaPath);
          }
          const mediaMsg = MessageMedia.fromFilePath(mediaPath);
          // Kirim media dengan caption (atau body sebagai caption)
          const msg = await client.sendMessage(targetChatId, mediaMsg, {
            caption: body || "",
          });
          const msgId = msg.id?._serialized || msg.id?.id;
          trackBotSentMessage(msgId);

          const fileExt = mediaPath.split(".").pop().toLowerCase();
          const tag = ["mp4", "mov", "avi"].includes(fileExt)
            ? "[VIDEO"
            : "[MEDIA";
          const logBody = `${tag}:/uploads/${path.basename(mediaPath)}] ${body || mediaAsset.label}`;

          await dashboard.addToChatHistory(storeWaId, {
            id: msgId,
            from: targetChatId,
            body: logBody,
            isMe: true,
            sender_name: "Follow-Up Bot",
          });
        } else {
          logger.warn(
            `[FollowUp] Media tidak ditemukan: ${mediaAsset.filename}. Kirim teks saja.`,
          );
          // Fallback: kirim teks saja jika media tidak ada
          if (body) {
            const msg = await client.sendMessage(targetChatId, body);
            const msgId = msg.id?._serialized || msg.id?.id;
            trackBotSentMessage(msgId);
            await dashboard.addToChatHistory(storeWaId, {
              id: msgId,
              from: targetChatId,
              body: body,
              isMe: true,
              sender_name: "Follow-Up Bot",
            });
          }
        }
      } else if (body) {
        // Kirim teks saja (tanpa media)
        const msg = await client.sendMessage(targetChatId, body);
        const msgId = msg.id?._serialized || msg.id?.id;
        trackBotSentMessage(msgId);
        await dashboard.addToChatHistory(storeWaId, {
          id: msgId,
          from: targetChatId,
          body: body,
          isMe: true,
          sender_name: "Follow-Up Bot",
        });
      }

      // TIDAK pause AI — follow-up harus tetap bisa ditangani oleh AI
      logger.info(`[${storeWaId}] Follow-Up dikirim ke [${targetChatId}].`);
      return true;
    } catch (error) {
      lastError = error;
      const isTransient =
        /timeout|detached|closed|destroyed|getChat|undefined|protocol error/i.test(
          error.message,
        );
      if (isTransient && attempt < MAX_SEND_RETRIES - 1) {
        logger.warn(
          `[${storeWaId}] Retry ${attempt + 1}/${MAX_SEND_RETRIES} kirim follow-up (${error.message}), tunggu ${RETRY_DELAY_MS / 1000}s...`,
        );
        await sleep(RETRY_DELAY_MS);
        // Re-check client readiness before retry
        try {
          await waitForActiveClient(storeWaId, 15000);
        } catch (_) {
          /* client mungkin belum siap, tetap coba */
        }
        continue;
      }
      logger.error(`[${storeWaId}] Gagal kirim follow-up: ${error.message}`);
      throw error;
    }
  } // end retry loop
  throw lastError || new Error("sendFollowUpMessage gagal setelah retry");
}

/**
 * Mengirim gambar QRIS (Buffer PNG) ke customer WhatsApp.
 * Dipanggil otomatis oleh AI tool handler setelah QRIS berhasil dibuat.
 *
 * TIDAK pause AI — customer masih harus bisa balas / dikonfirmasi bot.
 *
 * @param {string} storeWaId   - WA ID toko pengirim
 * @param {string} contactId   - WA ID/phone customer penerima
 * @param {Buffer} imageBuffer - Buffer PNG gambar QRIS
 * @param {string} caption     - Caption teks yang menyertai gambar
 */
async function sendQrisImage(storeWaId, contactId, imageBuffer, caption = "") {
  const client = await waitForActiveClient(storeWaId);
  const targetChatId = assertWaChatId(contactId);

  try {
    const { MessageMedia } = require("whatsapp-web.js");
    const base64Data = Buffer.isBuffer(imageBuffer)
      ? imageBuffer.toString("base64")
      : String(imageBuffer);
    const media = new MessageMedia(
      "image/png",
      base64Data,
      "qris_pembayaran.png",
    );
    const msg = await client.sendMessage(targetChatId, media, {
      caption: caption || "",
    });
    const msgId = msg?.id?._serialized || msg?.id?.id;
    trackBotSentMessage(msgId);

    // Log ke dashboard CRM
    await dashboard.addToChatHistory(storeWaId, {
      id: msgId,
      from: targetChatId,
      body: `[MEDIA:qris_pembayaran.png] ${caption || "QRIS Pembayaran"}`,
      isMe: true,
      sender_name: "Bot QRIS",
      timestamp: new Date(),
    });

    // TIDAK pause AI
    logger.info(
      `[${storeWaId}] QRIS image berhasil dikirim ke [${targetChatId}].`,
    );
    return true;
  } catch (error) {
    logger.error(
      `[${storeWaId}] Gagal kirim QRIS image ke [${targetChatId}]: ${error.message}`,
    );
    throw error;
  }
}

async function requestPhoneNumber(storeWaId, contactId) {
  return wajsBridge.requestPhoneNumber(
    getActiveClient(storeWaId),
    contactId,
    storeWaId,
  );
}

async function resolveContactPhone(storeWaId, contactId) {
  const client = getActiveClient(storeWaId);
  return wajsBridge.resolvePhoneForChatId(client, contactId, storeWaId);
}

async function getLabels(storeWaId) {
  return wajsBridge.getLabels(getActiveClient(storeWaId), storeWaId);
}

async function createLabel(storeWaId, name, color) {
  return wajsBridge.createLabel(
    getActiveClient(storeWaId),
    name,
    color,
    storeWaId,
  );
}

async function editLabel(storeWaId, labelId, updates) {
  return wajsBridge.editLabel(
    getActiveClient(storeWaId),
    labelId,
    updates,
    storeWaId,
  );
}

async function deleteLabel(storeWaId, labelId) {
  return wajsBridge.deleteLabel(getActiveClient(storeWaId), labelId, storeWaId);
}

async function getLabelColorPalette(storeWaId) {
  return wajsBridge.getLabelColorPalette(getActiveClient(storeWaId), storeWaId);
}

async function addOrRemoveLabels(storeWaId, contactIds, labelOps) {
  return wajsBridge.addOrRemoveLabels(
    getActiveClient(storeWaId),
    contactIds,
    labelOps,
    storeWaId,
  );
}

async function sendReaction(storeWaId, messageId, emoji) {
  return wajsBridge.sendReactionById(
    getActiveClient(storeWaId),
    messageId,
    emoji,
    storeWaId,
  );
}

async function forwardMessages(storeWaId, to, messageIds, options = {}) {
  const targetChatId = assertWaChatId(to);
  return wajsBridge.forwardMessages(
    getActiveClient(storeWaId),
    targetChatId,
    messageIds,
    options,
    storeWaId,
  );
}

/**
 * Mendapatkan pesan historis langsung dari WhatsApp (sinkronisasi)
 * dan menyimpannya ke database.
 */
async function syncMessagesFromWa(storeWaId, contactId, limit = 50) {
  const client = getActiveClient(storeWaId);
  if (!client) throw new Error("Client WhatsApp tidak aktif.");
  const targetChatId = assertWaChatId(contactId);

  try {
    const messages = await wajsBridge.getMessages(
      client,
      targetChatId,
      limit,
      storeWaId,
    );
    if (!messages || messages.length === 0) return { success: true, count: 0 };

    let addedCount = 0;
    for (const msg of messages) {
      // Mapping format message dari wajs_bridge.js ke format addToChatHistory
      const msgData = {
        wa_message_id: msg.id?._serialized || msg.id,
        from: targetChatId, // Selalu gunakan targetChatId agar masuk ke riwayat obrolan pelanggan yang benar
        to: msg.to,
        body: msg.body || "",
        isMe: msg.fromMe,
        timestamp: (() => {
          if (!msg.timestamp) return new Date();
          // Jika angkanya terlalu besar, berarti sudah ms, jika tidak berarti s (detik)
          return msg.timestamp > 1e11
            ? new Date(msg.timestamp)
            : new Date(msg.timestamp * 1000);
        })(),
        sender_name: msg.fromMe ? "Owner/CS (dari HP)" : "",
        quoted_message_id: msg.quotedMsgId || null,
        quoted_body: msg.quotedBody || null,
        quoted_from_me: msg.quotedFromMe || false,
        quoted_sender_name: msg.quotedSenderName || null,
        type: msg.type || "chat",
        hasMedia: msg.hasMedia,
      };

      if (msgData.hasMedia && !msgData.body) {
        msgData.body = "(Media/Attachment)";
      }

      try {
        await dashboard.addToChatHistory(storeWaId, msgData);
        addedCount++;
      } catch (err) {
        logger.warn(
          `[${storeWaId}] Gagal sinkronisasi pesan ${msgData.wa_message_id}: ${err.message}`,
        );
      }
    }

    logger.success(
      `[${storeWaId}] Berhasil sinkronisasi ${addedCount} pesan dari WhatsApp untuk kontak ${targetChatId}`,
    );
    return { success: true, count: addedCount };
  } catch (error) {
    logger.error(`[${storeWaId}] Gagal sinkronisasi pesan: ${error.message}`);
    throw error;
  }
}

/**
 * Global Sync: Menarik SEMUA chat dari WA Web dan masing-masing mengambil 10 pesan terakhir.
 * Dijalankan secara asynchronous (background) dan memancarkan socket event untuk progress.
 */
async function syncAllChatsFromWa(storeWaId) {
  const client = getActiveClient(storeWaId);
  if (!client) throw new Error("Client WhatsApp tidak aktif.");

  // Jalankan di background agar tidak memblokir HTTP request
  (async () => {
    try {
      const { socketService } = require("./services/socket.service");
      socketService.emitSyncProgress(storeWaId, {
        status: "fetching_chats",
        message: "Mengambil daftar kontak dari WhatsApp...",
      });

      // Ambil semua chat (limit tidak di-set agar terambil semua)
      // Di wajs_bridge, parameter getChats tidak dibatasi secara kaku jika pakai WPP.chat.getChats
      const allChats = await wajsBridge.getChats(client, storeWaId);
      if (!allChats || allChats.length === 0) {
        socketService.emitSyncProgress(storeWaId, {
          status: "completed",
          message: "Tidak ada chat yang ditemukan di WhatsApp.",
        });
        return;
      }

      const totalChats = allChats.length;
      socketService.emitSyncProgress(storeWaId, {
        status: "syncing_messages",
        total: totalChats,
        current: 0,
        message: `Menarik pesan dari ${totalChats} kontak...`,
      });

      let processed = 0;
      let totalAdded = 0;

      for (const chat of allChats) {
        try {
          const chatId = chat.id?._serialized || chat.id;
          if (!chatId || chatId === "status@broadcast") continue; // Skip status

          // Tarik 10 pesan terakhir untuk setiap kontak agar CRM punya history
          const messages = await wajsBridge.getMessages(
            client,
            chatId,
            10,
            storeWaId,
          );

          if (messages && messages.length > 0) {
            for (const msg of messages) {
              const msgData = {
                wa_message_id: msg.id?._serialized || msg.id,
                from: chat.id._serialized, // Selalu gunakan ID pelanggan
                to: msg.to,
                body: msg.body || "",
                isMe: msg.fromMe,
                timestamp: (() => {
                  if (!msg.timestamp) return new Date();
                  return msg.timestamp > 1e11
                    ? new Date(msg.timestamp)
                    : new Date(msg.timestamp * 1000);
                })(),
                sender_name: msg.fromMe
                  ? "Owner/CS (dari HP)"
                  : chat.name || "",
                quoted_message_id: msg.quotedMsgId || null,
                quoted_body: msg.quotedBody || null,
                quoted_from_me: msg.quotedFromMe || false,
                quoted_sender_name: msg.quotedSenderName || null,
                type: msg.type || "chat",
                hasMedia: msg.hasMedia,
              };

              if (msgData.hasMedia && !msgData.body) {
                msgData.body = "(Media/Attachment)";
              }

              try {
                await dashboard.addToChatHistory(storeWaId, msgData);
                totalAdded++;
              } catch (e) {
                // Ignore upsert dupes
              }
            }
          }
        } catch (e) {
          logger.warn(
            `[${storeWaId}] Gagal tarik pesan untuk ${chat.id?._serialized}: ${e.message}`,
          );
        }

        processed++;
        if (processed % 5 === 0 || processed === totalChats) {
          socketService.emitSyncProgress(storeWaId, {
            status: "syncing_messages",
            total: totalChats,
            current: processed,
            message: `Sinkronisasi: ${processed}/${totalChats} kontak...`,
          });
        }

        // Jeda 500ms per chat untuk mencegah rate limit WA dan beban CPU tinggi
        await new Promise((r) => setTimeout(r, 500));
      }

      socketService.emitSyncProgress(storeWaId, {
        status: "completed",
        message: `Sinkronisasi Global selesai! Tersimpan ${totalAdded} pesan dari ${processed} kontak.`,
      });
      logger.success(
        `[${storeWaId}] Global Sync selesai. Total: ${totalAdded} pesan, ${processed} kontak.`,
      );
    } catch (err) {
      logger.error(`[${storeWaId}] Error Global Sync: ${err.message}`);
      const { socketService } = require("./services/socket.service");
      socketService.emitSyncProgress(storeWaId, {
        status: "error",
        message: `Gagal sinkronisasi: ${err.message}`,
      });
    }
  })();

  return {
    success: true,
    message: "Proses sinkronisasi global dimulai di background.",
  };
}

/**
 * Logout Client, Putuskan Koneksi WA, dan Hapus Sesi Fisik
 * @param {string} storeWaId
 */
async function logoutClient(storeWaId) {
  const client = clients.get(storeWaId);
  readyClients.delete(storeWaId);
  stopClientSession(storeWaId);

  // 1. Matikan Client secara aman
  if (client) {
    try {
      await client.logout();
    } catch (e) {
      logger.warn(
        `[${storeWaId}] Logout API gagal (mungkin sudah terputus): ${e.message}`,
      );
    }
    try {
      await client.destroy();
    } catch (e) {}
    clients.delete(storeWaId);
  }
  initializedClients.delete(storeWaId);

  // 2. Hapus total folder sesi fisik (Clean Slate)
  const baseWwebjsDir = path.join(process.cwd(), ".wwebjs_auth");
  const sessionDir = path.join(baseWwebjsDir, `session-${storeWaId}`);
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    logger.success(`[${storeWaId}] Sesi fisik berhasil dihapus secara paksa.`);
  } catch (e) {
    logger.warn(`[${storeWaId}] Folder sesi mungkin sudah hilang.`);
  }

  dashboard.updateWAStatus(storeWaId, "disconnected");
}

async function restartClientRuntime(
  storeWaId,
  reason = "health-check",
  awaitResult = false,
) {
  if (restartingClients.has(storeWaId)) {
    logger.warn(
      `[${storeWaId}] Restart runtime sudah berjalan, skip permintaan baru.`,
    );
    if (awaitResult) {
      throw new Error("Restart already in progress");
    }
    return;
  }

  restartingClients.add(storeWaId);
  readyClients.delete(storeWaId);

  // 🔧 TIMEOUT SAFETY: Hapus flag restart setelah 60 detik maksimal
  // Mencegah flag stuck permanen jika restart gagal / crash di tengah jalan
  const safetyTimer = setTimeout(() => {
    if (restartingClients.has(storeWaId)) {
      logger.warn(`[${storeWaId}] ⚠️ Restart safety timeout — memaksa hapus flag restart`);
      restartingClients.delete(storeWaId);
      waSessionMonitor.markStatus(storeWaId, "disconnected");
    }
  }, 60000);
  // Pastikan timer tidak block event loop
  if (safetyTimer.unref) safetyTimer.unref();

  waSessionMonitor.markStatus(storeWaId, "reconnecting");
  dashboard.updateWAStatus(storeWaId, "initializing");

  // 🔧 HENTIKAN semua AI reply yang sedang berjalan untuk store ini
  // Tanpa ini, AI reply akan coba pakai client yang udah di-destroy → "getChat undefined"
  try {
    const { cancelActiveAIReplies } = require("./events/message_handler");
    if (typeof cancelActiveAIReplies === "function") {
      cancelActiveAIReplies(storeWaId);
      logger.info(`[${storeWaId}] AI replies dibatalkan sebelum restart`);
    }
  } catch (_) {}

  const client = clients.get(storeWaId);
  if (client) {
    try {
      await client.destroy();
    } catch (error) {
      logger.warn(
        `[${storeWaId}] Destroy runtime lama gagal (${reason}): ${cleanErrorMessage(error)}`,
      );
    }
    clients.delete(storeWaId);
  }
  initializedClients.delete(storeWaId);

  // Tunggu OS release Chromium profile lock (SingletonLock).
  // Tanpa jeda ini, Chromium baru crash: "browser is already running".
  await sleep(3000);
  cleanupSessionLocks(storeWaId);
  await sleep(2000); // Pastikan OS sync selesai sebelum launch baru

  const newClient = createWhatsAppClient(storeWaId);
  const { socketService } = require("./services/socket.service");
  setupEventListeners(newClient, storeWaId, socketService.getIO());

  const initPromise = newClient
    .initialize()
    .then(() => {
      beginClientSession(storeWaId);
    })
    .catch((error) => {
      logger.error(
        `[${storeWaId}] Restart runtime gagal: ${cleanErrorMessage(error)}`,
      );
      cleanupFailedClient(storeWaId);
      throw error;
    })
    .finally(() => {
      clearTimeout(safetyTimer);
      restartingClients.delete(storeWaId);
    });

  // P0 FIX: awaitResult=true -> caller bisa tahu berhasil/gagal (untuk retry logic)
  if (awaitResult) {
    return initPromise;
  }
}

/**
 * Membersihkan state internal saat launch gagal.
 * Dipanggil dari index.js saat client.initialize() crash/timeout.
 */
function cleanupFailedClient(storeWaId) {
  readyClients.delete(storeWaId);
  clients.delete(storeWaId);
  initializedClients.delete(storeWaId);
  waSessionMonitor.markStatus(storeWaId, "disconnected");
}

/**
 * Wire monitor & scheduler dependencies (called once at module load).
 */
function initWaRuntime() {
  waSessionMonitor.configure({
    getClient: (storeWaId) => clients.get(storeWaId),
    isRestarting: (storeWaId) => restartingClients.has(storeWaId),
    isReady: (storeWaId) => readyClients.has(storeWaId),
    restartClient: (storeWaId, reason) =>
      restartClientRuntime(storeWaId, reason, true),
    syncRecentChats: (storeWaId) =>
      syncRecentChatsFromWa(storeWaId, { source: "health-recovery" }),
    getActiveAIRepliesCount: () => {
      try {
        const { getActiveAIRepliesCount } = require("./events/message_handler");
        return getActiveAIRepliesCount?.() || 0;
      } catch (_) {
        return 0;
      }
    },
  });

  const waSyncScheduler = require("./services/wa_sync_scheduler.service");
  waSyncScheduler.configure({
    getActiveStoreIds: async () => {
      const { Store } = require("./models");
      const stores = await Store.findAll({
        where: { is_bot_active: true },
        attributes: ["wa_id"],
      });
      return stores.map((s) => s.wa_id);
    },
    syncRecentChats: (storeWaId) =>
      syncRecentChatsFromWa(storeWaId, { source: "background-scheduler" }),
    isRestarting: (storeWaId) => restartingClients.has(storeWaId),
    isReady: (storeWaId) => readyClients.has(storeWaId),
  });
}

initWaRuntime();

/**
 * Membuat WhatsApp Client temporer untuk scan QR (belum disimpan ke DB).
 * Client ini hanya untuk mendapatkan identitas WA (nomor & nama) via scan.
 * Auto-destroy setelah 2 menit jika tidak discan.
 * @param {object} io - Socket.IO instance untuk emit event
 * @returns {{ client: object, tempId: string }}
 */
function createTempClient(io) {
  const crypto = require("crypto");
  const tempId = `temp_${crypto.randomBytes(4).toString("hex")}`;

  cleanupSessionLocks(tempId);

  logger.info(`[${tempId}] Menyiapkan Temp Client untuk QR scan...`);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: tempId }),
    puppeteer: {
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-translate",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-default-apps",
        "--disable-features=TranslateUI",
        "--no-first-run",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-features=IsolateSandboxedIframes",
        "--js-flags=--max-old-space-size=256",
      ],
      headless: "new",
      handleSIGINT: false,
      timeout: 90000,
    },
  });

  client.__storeWaId = tempId;
  client.__isTemp = true;
  client.__tempScanned = false;

  // QR event — emit ke frontend untuk ditampilkan
  client.on("qr", (qr) => {
    logger.bot(`[${tempId}] QR Code siap untuk scan device baru`);
    if (io) {
      io.emit("qr", { storeId: tempId, qr, isTemp: true });
    }
  });

  // Ready event — user berhasil scan QR
  client.on("ready", async () => {
    logger.success(`[${tempId}] Temp client siap! User telah scan QR.`);
    const waId = client.info?.wid?.user || "";
    const pushName = client.info?.pushname || "";

    client.__tempScanned = true;

    if (io) {
      io.emit("temp_scan_ready", {
        tempSessionId: tempId,
        wa_id: waId,
        name: pushName,
      });
    }

    // Batalkan auto-destroy karena sudah discan
    if (client.__destroyTimer) {
      clearTimeout(client.__destroyTimer);
      client.__destroyTimer = null;
    }
  });

  client.on("disconnected", (reason) => {
    logger.error(`[${tempId}] Temp client terputus: ${reason}`);
    if (client.__destroyTimer) {
      clearTimeout(client.__destroyTimer);
      client.__destroyTimer = null;
    }
    tempClients.delete(tempId);
  });

  tempClients.set(tempId, client);

  // Auto-destroy setelah 2 menit jika tidak discan
  client.__destroyTimer = setTimeout(() => {
    if (tempClients.has(tempId) && !client.__tempScanned) {
      logger.warn(`[${tempId}] Temp client timeout (2 menit) — auto-destroy`);
      destroyTempClient(tempId);
    }
  }, 120000);

  return { client, tempId };
}

/**
 * Promosikan temp client menjadi permanent client setelah scan sukses & store dibuat.
 * Memindahkan session folder dan mendaftarkan ke permanent clients Map.
 * @param {string} tempId - ID temporer dari createTempClient()
 * @param {string} waId - Nomor WhatsApp hasil scan
 * @param {object} io - Socket.IO instance
 */
async function promoteTempClient(tempId, waId, io) {
  const client = tempClients.get(tempId);
  if (!client) throw new Error(`Temp client ${tempId} tidak ditemukan`);

  // Batalkan destroy timer
  if (client.__destroyTimer) {
    clearTimeout(client.__destroyTimer);
    client.__destroyTimer = null;
  }

  // === FIX EPIPE: Tutup browser dulu agar file locks (Cache_Data dll) dilepas ===
  // Chrome masih memegang file session folder saat client.initialize() sukses.
  // Jika kita rename/copy folder tanpa destroy browser, Windows akan throw EPIPE.
  try {
    await client.destroy();
    logger.info(`[${tempId}] Browser ditutup untuk memindahkan session folder`);
  } catch (e) {
    logger.warn(`[${tempId}] Gagal close browser: ${cleanErrorMessage(e)}`);
  }

  // TUNGGU OS melepas file lock (500ms cukup untuk Windows menutup semua handle)
  await sleep(500);

  // Hapus SingletonLock dll yang mungkin masih ada dari temp session
  cleanupSessionLocks(tempId);

  // Pindahkan session folder dari temp_xxx ke wa_id
  const baseWwebjsDir = path.join(process.cwd(), ".wwebjs_auth");
  const oldSessionDir = path.join(baseWwebjsDir, `session-${tempId}`);
  const newSessionDir = path.join(baseWwebjsDir, `session-${waId}`);

  // Hapus session permanent lama jika ada (corrupted session dari percobaan sebelumnya)
  if (fs.existsSync(newSessionDir)) {
    try {
      fs.rmSync(newSessionDir, { recursive: true, force: true });
    } catch (e) {
      logger.warn(
        `[${tempId}] Gagal hapus session lama ${waId}: ${cleanErrorMessage(e)}`,
      );
    }
    // Tunggu sebentar setelah delete
    await sleep(300);
  }

  if (fs.existsSync(oldSessionDir)) {
    try {
      fs.renameSync(oldSessionDir, newSessionDir);
      logger.info(`[${tempId}] Session dipindahkan ke ${waId}`);
    } catch (e) {
      // Fallback: copy + delete dengan retry
      try {
        fs.cpSync(oldSessionDir, newSessionDir, { recursive: true });
        logger.info(`[${tempId}] Session dicopy ke ${waId} (cpSync fallback)`);
      } catch (cpErr) {
        logger.error(
          `[${tempId}] Gagal copy session: ${cleanErrorMessage(cpErr)}`,
        );
      }
      // Hapus old session — pakai retry karena file mungkin masih dikunci
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (fs.existsSync(oldSessionDir)) {
            fs.rmSync(oldSessionDir, { recursive: true, force: true });
            logger.info(
              `[${tempId}] Old session dihapus (attempt ${attempt + 1})`,
            );
            break;
          }
        } catch (rmErr) {
          if (attempt < 2) {
            logger.warn(
              `[${tempId}] Retry hapus old session (${attempt + 1}/3): ${cleanErrorMessage(rmErr)}`,
            );
            await sleep(1000);
          } else {
            logger.error(
              `[${tempId}] Gagal hapus old session setelah 3x: ${cleanErrorMessage(rmErr)}`,
            );
          }
        }
      }
    }
  }

  // === PENTING: Hapus dari temp map SETELAH folder move selesai ===
  // Jika move gagal, temp client masih bisa di-destroy oleh destroyTempClient().
  tempClients.delete(tempId);

  // === FIX: Buat CLIENT BARU dengan clientId yang benar ===
  // Client lama sudah di-destroy(). Membuat client baru dengan clientId=waId
  // memastikan LocalAuth membaca session dari folder session-waId yang baru dipindah.
  initializedClients.delete(waId); // Reset agar setupEventListeners bisa jalan

  const newClient = createWhatsAppClient(waId);
  setupEventListeners(newClient, waId, io);

  // Initialize — akan auto-authenticate dari session yang sudah dipindahkan
  try {
    await newClient.initialize();
  } catch (e) {
    logger.error(
      `[${waId}] Gagal initialize permanent client: ${cleanErrorMessage(e)}`,
    );
    // Client mungkin tetap bisa dipakai meski initialize gagal (retry nanti)
  }

  // Init health check — ready event juga memanggil beginClientSession
  beginClientSession(waId);

  logger.success(
    `[${waId}] Temp client berhasil dipromosikan jadi permanent ✅`,
  );
  return newClient;
}

/**
 * Hancurkan temp client dan bersihkan resource-nya.
 * Dipanggil saat user batal, timeout, atau error.
 * @param {string} tempId - ID temporer
 */
async function destroyTempClient(tempId) {
  const client = tempClients.get(tempId);
  if (!client) return;

  // Batalkan destroy timer
  if (client.__destroyTimer) {
    clearTimeout(client.__destroyTimer);
    client.__destroyTimer = null;
  }

  // Destroy puppeteer browser (jangan logout — tidak ingin invalidate session)
  try {
    if (client.pupPage && !client.pupPage.isClosed?.()) {
      await client.destroy();
    }
  } catch (e) {
    logger.warn(
      `[${tempId}] Destroy temp client error: ${cleanErrorMessage(e)}`,
    );
  }

  tempClients.delete(tempId);

  // Bersihkan session folder
  const baseWwebjsDir = path.join(process.cwd(), ".wwebjs_auth");
  const sessionDir = path.join(baseWwebjsDir, `session-${tempId}`);
  try {
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  } catch (_) {}

  logger.info(`[${tempId}] Temp client destroyed & cleaned up`);
}

module.exports = {
  checkSendThrottle,
  resetSendThrottleForContact,
  createWhatsAppClient,
  createTempClient,
  promoteTempClient,
  destroyTempClient,
  trackBotSentMessage,
  setupEventListeners,
  getClients,
  cleanupAllSessionLocks,
  sendManualMessage,
  sendManualMedia,
  sendFollowUpMessage,
  sendQrisImage,
  requestPhoneNumber,
  resolveContactPhone,
  getLabels,
  createLabel,
  editLabel,
  deleteLabel,
  getLabelColorPalette,
  addOrRemoveLabels,
  sendReaction,
  forwardMessages,
  syncMessagesFromWa,
  syncAllChatsFromWa,
  logoutClient,
  restartClientRuntime,
  cleanupFailedClient,
  beginClientSession,
  stopClientSession,
  stopAllSessionMonitoring,
  syncRecentChatsFromWa,
  getSessionHealth: (storeWaId) =>
    waSessionMonitor.getHealthSnapshot(storeWaId),
  getAllSessionsHealth: () => waSessionMonitor.getAllHealthSnapshots(),
  buildSessionStatusMap: (storeWaIds, options) =>
    waSessionMonitor.buildStatusMap(storeWaIds, options),
  getClientWajsStatus: wajsBridge.getClientWajsStatus,
  waitForActiveClient,
  isCurrentClient,
  getActiveClient,
};
