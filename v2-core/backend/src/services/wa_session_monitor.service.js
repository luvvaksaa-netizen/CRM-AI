/**
 * wa_session_monitor.service.js
 *
 * Observability & auto-recovery for multi-session WhatsApp clients.
 * - Per-store health checks (state, puppeteer liveness, internal socket)
 * - Activity tracking for accurate UI status
 * - Idempotent interval management (safe across restarts)
 */

const logger = require("../utils/logger");

const CHECK_INTERVAL_MS = Number(process.env.WA_HEALTH_CHECK_INTERVAL_MS || 300_000);
const HANG_TIMEOUT_MS = Number(process.env.WA_HEALTH_HANG_TIMEOUT_MS || 30_000);
const CHAT_PROBE_TIMEOUT_MS = Number(process.env.WA_CHAT_PROBE_TIMEOUT_MS || 45_000);
const SYNCING_STALE_MS = Number(process.env.WA_SYNCING_STALE_MS || 600_000);

let deps = {
  getClient: () => null,
  isRestarting: () => false,
  isReady: () => false,
  restartClient: async () => {},
  syncRecentChats: async () => {},
  getActiveAIRepliesCount: () => 0,
};

const monitorIntervals = new Map();
const sessionHealth = new Map();

function configure(overrides) {
  deps = { ...deps, ...overrides };
}

function cleanErrorMessage(error) {
  return String(error?.message || error || "Unknown error").split("\n")[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${timeoutMs}ms)`)), timeoutMs),
    ),
  ]);
}

function recordActivity(storeWaId, source = "message") {
  const now = Date.now();
  const current = sessionHealth.get(storeWaId) || createEmptyHealth(storeWaId);
  current.lastActivityAt = now;
  current.lastActivitySource = source;
  current.updatedAt = now;
  sessionHealth.set(storeWaId, current);
}

function createEmptyHealth(storeWaId) {
  return {
    storeWaId,
    status: "unknown",
    clientState: null,
    internalSocketState: null,
    isHealthy: false,
    lastActivityAt: null,
    lastActivitySource: null,
    lastCheckAt: null,
    lastCheckOkAt: null,
    lastFailureReason: null,
    syncingSince: null,
    statusChangedAt: null,
    consecutiveFails: 0,
    checkCount: 0,
    recoveryCount: 0,
    updatedAt: Date.now(),
  };
}

function updateHealth(storeWaId, patch) {
  const current = sessionHealth.get(storeWaId) || createEmptyHealth(storeWaId);
  sessionHealth.set(storeWaId, { ...current, ...patch, updatedAt: Date.now() });
  return sessionHealth.get(storeWaId);
}

function getHealthSnapshot(storeWaId) {
  return sessionHealth.get(storeWaId) || createEmptyHealth(storeWaId);
}

function getAllHealthSnapshots() {
  const out = {};
  for (const [storeWaId, health] of sessionHealth.entries()) {
    out[storeWaId] = { ...health };
  }
  return out;
}

async function readInternalSocketState(client) {
  if (!client?.pupPage || client.pupPage.isClosed?.()) return null;
  return client.pupPage.evaluate(() =>
    window.Store?.State?.Socket?.state ?? null,
  );
}

async function probeChatApi(client) {
  if (client?.__wajsReady) {
    const wajsBridge = require("./wajs_bridge");
    const storeWaId = client.__storeWaId || client.options?.authStrategy?.clientId;
    return withTimeout(
      wajsBridge.getChats(client, storeWaId),
      CHAT_PROBE_TIMEOUT_MS,
      "getChats",
    );
  }
  return withTimeout(client.getChats(), CHAT_PROBE_TIMEOUT_MS, "getChats");
}

function derivePublicStatus(health, { hasClient, hasQr, isRestarting }) {
  if (hasQr) return "needs_scan";
  if (isRestarting) return "reconnecting";
  if (!hasClient) return "disconnected";
  if (health.status === "initializing") return "initializing";
  if (health.status === "authenticating") return "authenticating";
  if (!health.isHealthy && health.clientState) return "degraded";
  if (health.isHealthy || health.clientState === "CONNECTED") return "ready";
  return health.status || "unknown";
}

async function resolveClientState(client) {
  return withTimeout(client.getState(), HANG_TIMEOUT_MS, "getState");
}

async function runHealthCheck(storeWaId) {
  if (deps.isRestarting(storeWaId)) return;

  const client = deps.getClient(storeWaId);
  const health = getHealthSnapshot(storeWaId);

  // 🔧 JANGAN jalankan health check saat client sedang menunggu QR scan / transisi
  // getState() return state abnormal saat unauthenticated → false positive restart loop
  const status = health.status;
  if (status === "initializing" || status === "needs_scan" || status === "authenticating") {
    // Hanya restart jika stuck > 10 menit tanpa aktivitas (fallback safety)
    const stuckMs = Date.now() - (health.lastCheckAt || health.updatedAt || Date.now());
    if (stuckMs < 600000) return; // 10 menit grace period — user sedang scan QR
    logger.warn(`[${storeWaId}] Phase ${status} stuck > 10 menit — triggering restart`);
  }

  // 🔧 GRACE PERIOD: Jangan probe health check 180 detik setelah ready
  // Puppeteer/Chrome butuh waktu untuk stabilisasi internal state setelah autentikasi
  const msSinceStatusChange = health.statusChangedAt
    ? (Date.now() - health.statusChangedAt)
    : Infinity;
  if (status === "ready" && msSinceStatusChange < 180000) {
    // Update metadata tapi jangan probe getState/getChats yang bisa gagal
    updateHealth(storeWaId, { lastCheckAt: Date.now() });
    return;
  }

  if (!client) {
    updateHealth(storeWaId, {
      status: "disconnected",
      isHealthy: false,
      clientState: null,
      lastCheckAt: Date.now(),
      lastFailureReason: "Client not in registry",
    });
    return;
  }

  health.checkCount += 1;

  try {
    const activeAi = deps.getActiveAIRepliesCount?.() || 0;
    if (activeAi > 0) {
      logger.info(
        `[${storeWaId}] Health check ditunda — ${activeAi} AI reply sedang berjalan.`,
      );
      return;
    }

    let clientState;
    try {
      clientState = await resolveClientState(client);
    } catch (stateErr) {
      throw new Error(`State probe failed: ${cleanErrorMessage(stateErr)}`);
    }

    const normalizedState = String(clientState || "").toUpperCase();
    if (!clientState || normalizedState === "DISCONNECTED") {
      throw new Error(`Client disconnected (state=${clientState || "null"})`);
    }

    let internalState = null;
    try {
      internalState = await readInternalSocketState(client);
    } catch (evalErr) {
      throw new Error(`Puppeteer page unresponsive: ${cleanErrorMessage(evalErr)}`);
    }

    if (internalState && internalState !== "CONNECTED") {
      const syncingSince = health.syncingSince || Date.now();
      if (internalState === "SYNCING") {
        if (!health.syncingSince) {
          updateHealth(storeWaId, { syncingSince });
        } else if (Date.now() - health.syncingSince > SYNCING_STALE_MS) {
          throw new Error(`Stuck in SYNCING > ${Math.round(SYNCING_STALE_MS / 60000)} menit`);
        }
        updateHealth(storeWaId, {
          status: "degraded",
          clientState,
          internalSocketState: internalState,
          isHealthy: false,
          lastCheckAt: Date.now(),
          lastFailureReason: "SYNCING",
          syncingSince,
        });
        emitStatus(storeWaId, "degraded");
        return;
      }
      throw new Error(`Silent disconnect (internal=${internalState})`);
    }

    await probeChatApi(client);

    updateHealth(storeWaId, {
      status: "ready",
      clientState,
      internalSocketState: internalState,
      isHealthy: true,
      lastCheckAt: Date.now(),
      lastCheckOkAt: Date.now(),
      lastFailureReason: null,
      syncingSince: null,
      consecutiveFails: 0,
    });
    emitStatus(storeWaId, deps.isReady(storeWaId) ? "ready" : "initializing");
  } catch (error) {
    const fullMsg = String(error?.message || error || "Unknown");
    const reason = cleanErrorMessage(error);
    const consecutiveFails = (health.consecutiveFails || 0) + 1;
    logger.error(`[${storeWaId}] Health check gagal (${consecutiveFails}/3): ${fullMsg.substring(0, 200)}`);

    updateHealth(storeWaId, {
      status: "degraded",
      isHealthy: false,
      lastCheckAt: Date.now(),
      lastFailureReason: reason,
      recoveryCount: (health.recoveryCount || 0) + 1,
      consecutiveFails,
    });
    emitStatus(storeWaId, "degraded");

    // 🔧 Hanya restart jika 3x gagal berturut-turut — hindari false positive
    if (consecutiveFails >= 3) {
      logger.warn(`[${storeWaId}] ${consecutiveFails} health check gagal berturut-turut — restart`);
      updateHealth(storeWaId, { consecutiveFails: 0 });
      try {
        await deps.restartClient(storeWaId, "health-check");
      } catch (restartErr) {
        logger.error(
          `[${storeWaId}] Auto-recovery gagal: ${cleanErrorMessage(restartErr)}`,
        );
      }
    }
  }
}

function emitStatus(storeWaId, status) {
  try {
    const { socketService } = require("./socket.service");
    socketService.emitStatusUpdate(storeWaId, status);
  } catch (_) {
    /* non-critical */
  }
}

function startMonitoring(storeWaId) {
  stopMonitoring(storeWaId);

  if (!sessionHealth.has(storeWaId)) {
    sessionHealth.set(storeWaId, createEmptyHealth(storeWaId));
  }

  const intervalId = setInterval(() => {
    runHealthCheck(storeWaId).catch((err) => {
      logger.error(
        `[${storeWaId}] Health check unhandled: ${cleanErrorMessage(err)}`,
      );
    });
  }, CHECK_INTERVAL_MS);

  monitorIntervals.set(storeWaId, intervalId);
  logger.info(
    `[${storeWaId}] Session monitor aktif (interval ${Math.round(CHECK_INTERVAL_MS / 1000)}s)`,
  );

  setTimeout(() => runHealthCheck(storeWaId), 15_000);
}

function stopMonitoring(storeWaId) {
  const intervalId = monitorIntervals.get(storeWaId);
  if (intervalId) {
    clearInterval(intervalId);
    monitorIntervals.delete(storeWaId);
  }
}

function stopAllMonitoring() {
  for (const storeWaId of [...monitorIntervals.keys()]) {
    stopMonitoring(storeWaId);
  }
  logger.info("[SessionMonitor] Semua monitor dihentikan");
}

function markStatus(storeWaId, status) {
  const current = sessionHealth.get(storeWaId);
  const prevStatus = current?.status;
  // 🔧 Selalu update statusChangedAt saat status berubah atau saat ready
  // Ini penting untuk grace period setelah restart loop
  const changed = prevStatus !== status || status === "ready";
  updateHealth(storeWaId, {
    status,
    ...(changed ? { statusChangedAt: Date.now() } : {}),
  });
  emitStatus(storeWaId, status);
}

async function buildStatusMap(storeWaIds, { qrCodes = {} } = {}) {
  const statuses = {};
  const health = {};

  for (const waId of storeWaIds) {
    const snapshot = getHealthSnapshot(waId);
    const hasClient = Boolean(deps.getClient(waId));
    const hasQr = Boolean(qrCodes[waId]);
    const isRestarting = deps.isRestarting(waId);

    const publicStatus = derivePublicStatus(snapshot, {
      hasClient,
      hasQr,
      isRestarting,
    });

    statuses[waId] = publicStatus;
    health[waId] = {
      ...snapshot,
      publicStatus,
      hasClient,
      isRestarting,
    };
  }

  return { statuses, health };
}

module.exports = {
  configure,
  recordActivity,
  startMonitoring,
  stopMonitoring,
  stopAllMonitoring,
  markStatus,
  getHealthSnapshot,
  getAllHealthSnapshots,
  buildStatusMap,
  runHealthCheck,
};
