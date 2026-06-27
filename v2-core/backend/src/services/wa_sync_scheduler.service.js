/**
 * wa_sync_scheduler.service.js
 *
 * Background staggered sync for active WA stores.
 * Catches messages missed during silent disconnects without restarting all clients.
 */

const logger = require("../utils/logger");

const SYNC_INTERVAL_MS = Number(process.env.WA_BG_SYNC_INTERVAL_MS || 30 * 60_000);
const SYNC_STAGGER_MS = Number(process.env.WA_BG_SYNC_STAGGER_MS || 120_000);
const SYNC_ENABLED = process.env.WA_BG_SYNC_ENABLED !== "false";

let schedulerTimer = null;
let running = false;

function configure(deps) {
  module.exports._deps = deps;
}

function getDeps() {
  return (
    module.exports._deps || {
      getActiveStoreIds: async () => [],
      syncRecentChats: async () => {},
      isRestarting: () => false,
      isReady: () => false,
    }
  );
}

function cleanErrorMessage(error) {
  return String(error?.message || error || "Unknown error").split("\n")[0];
}

async function runSyncCycle() {
  if (running) {
    logger.info("[WaSyncScheduler] Siklus sebelumnya masih berjalan, skip.");
    return;
  }

  running = true;
  const deps = getDeps();

  try {
    const storeIds = await deps.getActiveStoreIds();
    if (!storeIds.length) return;

    logger.info(
      `[WaSyncScheduler] Memulai sync background untuk ${storeIds.length} store (stagger ${Math.round(SYNC_STAGGER_MS / 1000)}s)`,
    );

    for (let i = 0; i < storeIds.length; i++) {
      const storeWaId = storeIds[i];
      if (deps.isRestarting(storeWaId) || !deps.isReady(storeWaId)) {
        continue;
      }

      try {
        await deps.syncRecentChats(storeWaId);
      } catch (err) {
        logger.warn(
          `[WaSyncScheduler] Sync gagal untuk ${storeWaId}: ${cleanErrorMessage(err)}`,
        );
      }

      if (i < storeIds.length - 1) {
        await new Promise((r) => setTimeout(r, SYNC_STAGGER_MS));
      }
    }

    logger.success("[WaSyncScheduler] Siklus sync background selesai");
  } catch (err) {
    logger.error(`[WaSyncScheduler] Siklus error: ${cleanErrorMessage(err)}`);
  } finally {
    running = false;
  }
}

function startScheduler() {
  if (!SYNC_ENABLED) {
    logger.info("[WaSyncScheduler] Disabled (WA_BG_SYNC_ENABLED=false)");
    return;
  }

  stopScheduler();

  schedulerTimer = setInterval(() => {
    runSyncCycle().catch(() => {});
  }, SYNC_INTERVAL_MS);

  const initialDelay = Number(process.env.WA_BG_SYNC_INITIAL_DELAY_MS || 300_000);
  setTimeout(() => runSyncCycle().catch(() => {}), initialDelay);

  logger.info(
    `[WaSyncScheduler] Aktif — interval ${Math.round(SYNC_INTERVAL_MS / 60000)} menit, first run in ${Math.round(initialDelay / 60000)} menit`,
  );
}

function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

module.exports = {
  configure,
  startScheduler,
  stopScheduler,
  runSyncCycle,
};
