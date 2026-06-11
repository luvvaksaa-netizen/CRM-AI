/**
 * followup.service.ts — Migration from followup_service.js
 * Automated Follow-Up System — Multi-Stage Customer Re-Engagement.
 *
 * KEY FEATURES:
 *  - 4-stage follow-up pipeline (10min, 1hr, 7pm, 6am next day)
 *  - Random delay 2-5 minutes between customers (anti-spam/anti-banned)
 *  - Multiple copywriting templates per stage (variasi anti-deteksi)
 *  - Personalized with customer name from chat summary
 *  - Auto-cancel when customer replies
 *  - Respects bot toggle (global + per-contact pause)
 *  - Context-aware: references last conversation topic
 */

import { Op } from 'sequelize';
import logger from '../utils/logger';
import { FollowUp, Store, ChatSummary, MediaAsset, BotAgent, ChatMessage } from '../models/index';

// ══════════════════════════════════════════════════════════════════
// FOLLOW-UP STAGE TEMPLATES
// ══════════════════════════════════════════════════════════════════

export const DEFAULT_FOLLOWUP_CONFIG: Record<number, any> = {
  1: {
    delay_minutes: 10,
    media_type: 'video',
    media_label_hints: ['video label', 'video produk', 'video'],
    ai_instruction: "Sapa ramah, beri tahu ada video cara pemakaian yang bagus. Ajak untuk pesan sekarang."
  },
  2: {
    delay_minutes: 60,
    media_type: 'image',
    media_label_hints: ['value', 'keunggulan', 'foto value', 'testimoni'],
    ai_instruction: "Berikan keunggulan produk (misal: anti air, tidak luntur). Sapa ramah."
  },
  3: {
    scheduled_hour: 19,
    media_type: 'video',
    media_label_hints: ['video label', 'video produk', 'video'],
    ai_instruction: "Ingatkan bahwa kalau pesan malam ini, besok bisa langsung diproses/dikirim."
  },
  4: {
    scheduled_hour: 6,
    scheduled_next_day: true,
    media_type: 'mixed',
    media_label_hints: ['testimoni', 'pemasangan', 'video pemasangan', 'review', 'video', 'value'],
    ai_instruction: "Ucapkan selamat pagi. Beri tahu banyak customer lain puas dengan hasilnya. Tanyakan apakah masih berminat pesan."
  }
};

const SCHEDULER_INTERVAL_MS = 60 * 1000;
const RANDOM_DELAY_MIN_MS = 2 * 60 * 1000;
const RANDOM_DELAY_MAX_MS = 5 * 60 * 1000;
const MAX_CONCURRENT_FU = 5;

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;
let ioRef: any = null;

export async function getFollowUpConfig(storeWaId: string): Promise<Record<number, any>> {
  try {
    const store: any = await Store.findOne({ where: { wa_id: storeWaId } });
    if (store && store.followup_config) {
      const parsed = JSON.parse(store.followup_config);
      if (parsed && typeof parsed === 'object' && parsed['1']) {
        return parsed;
      }
    }
  } catch (e: any) {
    logger.warn(`[FollowUp] Gagal parse config DB untuk ${storeWaId}, pakai default.`);
  }
  return DEFAULT_FOLLOWUP_CONFIG;
}

export function initFollowUpScheduler(io: any): void {
  ioRef = io;

  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  schedulerInterval = setInterval(async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      await processScheduledFollowUps();
    } catch (e: any) {
      logger.error(`[FollowUp] Scheduler error: ${e.message}`);
    } finally {
      isProcessing = false;
    }
  }, SCHEDULER_INTERVAL_MS);

  logger.success('[FollowUp] Scheduler otomatis aktif (cek tiap 60 detik).');
}

async function processScheduledFollowUps(): Promise<void> {
  const now = new Date();

  const pendingList: any[] = await (FollowUp as any).findAll({
    where: {
      status: 'pending',
      scheduled_at: { [Op.lte]: now }
    },
    order: [['scheduled_at', 'ASC']],
    limit: MAX_CONCURRENT_FU
  });

  if (pendingList.length === 0) return;
  logger.info(`[FollowUp] ${pendingList.length} follow-up siap dikirim.`);

  for (let i = 0; i < pendingList.length; i++) {
    const fu = pendingList[i];
    try {
      await executeFollowUp(fu);
    } catch (err: any) {
      logger.error(`[FollowUp] Gagal eksekusi stage-${fu.stage} untuk [${fu.contact_id}]: ${err.message}`);
      await fu.update({ status: 'cancelled', cancel_reason: `Error: ${err.message}` });
    }

    if (i < pendingList.length - 1) {
      const delay = Math.floor(Math.random() * (RANDOM_DELAY_MAX_MS - RANDOM_DELAY_MIN_MS)) + RANDOM_DELAY_MIN_MS;
      logger.info(`[FollowUp] Jeda ${Math.round(delay / 1000)}s sebelum follow-up berikutnya...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function executeFollowUp(followUp: any): Promise<void> {
  // 1. Guard: Cek apakah bot masih aktif
  const store: any = await Store.findOne({
    where: { wa_id: followUp.store_wa_id },
    include: [{ model: BotAgent, as: 'BotAgent' }]
  });

  if (!store || store.is_bot_active === false) {
    await followUp.update({ status: 'cancelled', cancel_reason: 'Bot non-aktif' });
    logger.info(`[FollowUp] Dibatalkan (bot OFF): stage-${followUp.stage} [${followUp.contact_id}]`);
    emitFollowUpUpdate(followUp.store_wa_id);
    return;
  }

  // 2. Guard: Cek apakah kontak di-pause
  const { pausedContacts } = require('../events/message_handler');
  const pauseKey = `${followUp.store_wa_id}_${followUp.contact_id}`;
  if (pausedContacts.has(pauseKey)) {
    await followUp.update({ status: 'cancelled', cancel_reason: 'Kontak dipause oleh CS' });
    logger.info(`[FollowUp] Dibatalkan (paused): stage-${followUp.stage} [${followUp.contact_id}]`);
    emitFollowUpUpdate(followUp.store_wa_id);
    return;
  }

  // 3. Guard: Cek apakah percakapan sudah closing
  const freshSummary: any = await (ChatSummary as any).findOne({
    where: { store_wa_id: followUp.store_wa_id, contact_id: followUp.contact_id }
  });

  if (freshSummary?.summary) {
    const { isConversationClosed } = require('./bot_activation_service');
    if (isConversationClosed(freshSummary.summary)) {
      await followUp.update({ status: 'cancelled', cancel_reason: 'Percakapan sudah closing/selesai' });
      logger.info(`[FollowUp] Dibatalkan (closing): stage-${followUp.stage} [${followUp.contact_id}]`);
      emitFollowUpUpdate(followUp.store_wa_id);
      return;
    }
  }

  // 4. Guard: Cek apakah CS sudah membalas manual dari HP
  const csManualReply = await (ChatMessage as any).findOne({
    where: {
      store_wa_id: followUp.store_wa_id,
      contact_id: followUp.contact_id,
      is_from_me: true,
      sender_name: 'CS (dari HP)',
      timestamp: { [Op.gt]: followUp.createdAt }
    }
  });

  if (csManualReply) {
    await followUp.update({ status: 'cancelled', cancel_reason: 'CS sudah membalas manual dari HP' });
    logger.info(`[FollowUp] Dibatalkan (CS manual reply): stage-${followUp.stage} [${followUp.contact_id}]`);
    emitFollowUpUpdate(followUp.store_wa_id);
    return;
  }

  // 5. Guard: Cek apakah customer sudah merespons
  const recentCustomerMsg = await (ChatMessage as any).findOne({
    where: {
      store_wa_id: followUp.store_wa_id,
      contact_id: followUp.contact_id,
      is_from_me: false,
      timestamp: { [Op.gt]: followUp.createdAt }
    },
    order: [['timestamp', 'DESC']]
  });

  if (recentCustomerMsg) {
    await followUp.update({ status: 'replied', cancel_reason: 'Customer sudah merespons' });
    logger.info(`[FollowUp] Dibatalkan (customer reply): stage-${followUp.stage} [${followUp.contact_id}]`);
    emitFollowUpUpdate(followUp.store_wa_id);
    return;
  }

  const config = await getFollowUpConfig(followUp.store_wa_id);
  const template = config[followUp.stage];
  if (!template) {
    await followUp.update({ status: 'cancelled', cancel_reason: 'Template config tidak ditemukan' });
    return;
  }

  const customerName = followUp.contact_name || 'kak';

  // 6. Generate pesan lewat AI
  const aiService = require('../ai_service');
  const productKnowledge = store.BotAgent?.product_knowledge || '';
  const personalizedCopy = await aiService.generateOrganicFollowUp(
    customerName,
    followUp.last_chat_context,
    template.ai_instruction,
    productKnowledge
  );

  // 7. Cari media yang sesuai dari katalog Agent
  const agentId = store.agent_id;
  let mediaToSend: any = null;

  if (agentId && template.media_label_hints.length > 0) {
    let productKeyword = '';
    try {
      const summaryRecord: any = await (ChatSummary as any).findOne({
        where: { store_wa_id: followUp.store_wa_id, contact_id: followUp.contact_id }
      });
      const summaryText = (summaryRecord?.summary || '').toLowerCase();

      if (summaryText.includes('dtf uv') || summaryText.includes('label dtf uv') || summaryText.includes('uv dtf') || summaryText.includes('stiker keras')) {
        productKeyword = 'uv';
      } else if (summaryText.includes('dtf') || summaryText.includes('label dtf') || summaryText.includes('bahan setrika')) {
        productKeyword = 'dtf';
      }
    } catch (summaryErr: any) {
      logger.warn(`[FollowUp] Gagal membaca preferensi produk untuk [${followUp.contact_id}]: ${summaryErr.message}`);
    }

    const allMedia: any[] = await (MediaAsset as any).findAll({
      where: {
        agent_id: agentId,
        purpose: { [Op.ne]: 'knowledge_only' }
      }
    });

    // Taktik 1: Cari media yang cocok dengan keyword produk
    if (productKeyword) {
      for (const hint of template.media_label_hints) {
        const match = allMedia.find((m: any) => {
          const labelLower = (m.label || '').toLowerCase();
          return labelLower.includes(hint.toLowerCase()) &&
            labelLower.includes(productKeyword) &&
            (template.media_type === 'mixed' || m.type === template.media_type);
        });
        if (match) { mediaToSend = match; break; }
      }
    }

    // Taktik 2: Fallback ke hint label umum
    if (!mediaToSend) {
      for (const hint of template.media_label_hints) {
        const match = allMedia.find((m: any) => {
          const labelLower = (m.label || '').toLowerCase();
          return labelLower.includes(hint.toLowerCase()) &&
            (template.media_type === 'mixed' || m.type === template.media_type);
        });
        if (match) { mediaToSend = match; break; }
      }
    }

    // Taktik 3: Fallback terakhir ke media pertama sesuai tipe
    if (!mediaToSend && template.media_type !== 'mixed') {
      mediaToSend = allMedia.find((m: any) => m.type === template.media_type);
    }
  }

  // 8. Kirim via WhatsApp dengan retry
  const MAX_WAIT_RESTART_MS = 3 * 60 * 1000;
  const startWait = Date.now();

  while (true) {
    try {
      const whatsappService = require('../whatsapp_service');
      await whatsappService.sendFollowUpMessage(
        followUp.store_wa_id,
        followUp.contact_id,
        personalizedCopy,
        mediaToSend
      );

      await followUp.update({ status: 'sent', sent_at: new Date() });
      const nextStage = followUp.stage + 1;
      logger.success(`[FollowUp] ✅ Stage-${followUp.stage} terkirim ke [${customerName}] (${followUp.contact_id})`);

      // Jadwalkan stage berikutnya
      if (followUp.stage < 4) {
        await scheduleNextStage(followUp);
      }

      emitFollowUpUpdate(followUp.store_wa_id);
      return;
    } catch (sendErr: any) {
      const isRestartError = /null|evaluate|detached|not ready|belum siap/i.test(sendErr.message);
      const elapsed = Date.now() - startWait;

      if (isRestartError && elapsed < MAX_WAIT_RESTART_MS) {
        logger.warn(`[FollowUp] Client sedang restart, menunggu 15 detik...`);
        await new Promise(r => setTimeout(r, 15000));
        continue;
      }

      const retryAt = new Date(Date.now() + 5 * 60 * 1000);
      await followUp.update({ scheduled_at: retryAt });
      logger.info(`[FollowUp] Follow-up stage-${followUp.stage} dijadwal ulang ke ${retryAt.toLocaleTimeString('id-ID')}`);
      emitFollowUpUpdate(followUp.store_wa_id);
      return;
    }
  }
}

async function scheduleNextStage(currentFollowUp: any): Promise<void> {
  const nextStage = currentFollowUp.stage + 1;
  const config = await getFollowUpConfig(currentFollowUp.store_wa_id);
  const nextTemplate = config[nextStage];
  if (!nextTemplate) return;

  const scheduledAt = calculateScheduleTime(nextTemplate);

  await (FollowUp as any).create({
    store_wa_id: currentFollowUp.store_wa_id,
    contact_id: currentFollowUp.contact_id,
    contact_name: currentFollowUp.contact_name,
    stage: nextStage,
    scheduled_at: scheduledAt,
    status: 'pending',
    last_chat_context: currentFollowUp.last_chat_context
  });

  logger.info(`[FollowUp] Stage-${nextStage} dijadwalkan untuk [${currentFollowUp.contact_name}] pada ${scheduledAt.toLocaleString('id-ID')}`);
}

export function calculateScheduleTime(template: any): Date {
  const now = new Date();

  if (template.delay_minutes) {
    return new Date(now.getTime() + template.delay_minutes * 60 * 1000);
  }

  if (template.scheduled_hour !== undefined) {
    const target = new Date(now);
    target.setHours(template.scheduled_hour, 0, 0, 0);

    if (target <= now || template.scheduled_next_day) {
      target.setDate(target.getDate() + 1);
    }

    return target;
  }

  return new Date(now.getTime() + 30 * 60 * 1000);
}

// ══════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════

export async function scheduleFollowUp(storeWaId: string, contactId: string, contactName: string, chatContext: string): Promise<any> {
  try {
    const existing = await (FollowUp as any).findOne({
      where: { store_wa_id: storeWaId, contact_id: contactId, status: 'pending' }
    });

    if (existing) return null;

    const config = await getFollowUpConfig(storeWaId);
    const template = config[1];
    if (!template) return null;

    const scheduledAt = calculateScheduleTime(template);

    const followUp = await (FollowUp as any).create({
      store_wa_id: storeWaId,
      contact_id: contactId,
      contact_name: contactName || 'kak',
      stage: 1,
      scheduled_at: scheduledAt,
      status: 'pending',
      last_chat_context: chatContext || ''
    });

    logger.info(`[FollowUp] Stage-1 dijadwalkan untuk [${contactName}] pada ${scheduledAt.toLocaleString('id-ID')}`);
    emitFollowUpUpdate(storeWaId);
    return followUp;
  } catch (e: any) {
    logger.error(`[FollowUp] Gagal menjadwalkan: ${e.message}`);
    return null;
  }
}

export async function cancelPendingFollowUps(storeWaId: string, contactId: string, reason: string = 'Customer merespons'): Promise<number> {
  try {
    const [updated] = await (FollowUp as any).update(
      { status: 'replied', cancel_reason: reason },
      { where: { store_wa_id: storeWaId, contact_id: contactId, status: 'pending' } }
    );

    if (updated > 0) {
      let display = contactId;
      try {
        const summary: any = await (ChatSummary as any).findOne({ where: { store_wa_id: storeWaId, contact_id: contactId } });
        if (summary && summary.contact_name) {
          display = `[${summary.contact_name}${summary.contact_phone ? ' | +' + summary.contact_phone : ''}] (${contactId})`;
        }
      } catch (e) { /* ignore */ }

      logger.info(`[FollowUp] ${updated} follow-up dibatalkan untuk ${display}: ${reason}`);
      emitFollowUpUpdate(storeWaId);
    }
    return updated;
  } catch (e: any) {
    logger.error(`[FollowUp] Gagal membatalkan: ${e.message}`);
    return 0;
  }
}

export async function cancelFollowUpById(followUpId: number, reason: string = 'Dibatalkan manual oleh CS'): Promise<boolean> {
  const fu: any = await (FollowUp as any).findByPk(followUpId);
  if (!fu || fu.status !== 'pending') return false;

  await fu.update({ status: 'cancelled', cancel_reason: reason });
  emitFollowUpUpdate(fu.store_wa_id);
  logger.info(`[FollowUp] Follow-up #${followUpId} dibatalkan manual.`);
  return true;
}

export async function getFollowUps(storeWaId: string, options: any = {}): Promise<any[]> {
  const where: any = { store_wa_id: storeWaId };

  if (options.status) {
    where.status = options.status;
  }

  return (FollowUp as any).findAll({
    where,
    order: [['scheduled_at', 'DESC']],
    limit: options.limit || 100
  });
}

export async function getFollowUpStats(storeWaId: string): Promise<{ pending: number; sent: number; replied: number; total: number }> {
  const [pending, sent, replied] = await Promise.all([
    (FollowUp as any).count({ where: { store_wa_id: storeWaId, status: 'pending' } }),
    (FollowUp as any).count({ where: { store_wa_id: storeWaId, status: 'sent' } }),
    (FollowUp as any).count({ where: { store_wa_id: storeWaId, status: 'replied' } })
  ]);

  return { pending, sent, replied, total: pending + sent + replied };
}

export async function getAllPendingCount(): Promise<number> {
  return (FollowUp as any).count({ where: { status: 'pending' } });
}

export async function cleanupOldFollowUps(): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const deleted = await (FollowUp as any).destroy({
    where: {
      status: { [Op.ne]: 'pending' },
      createdAt: { [Op.lt]: cutoff }
    }
  });

  if (deleted > 0) {
    logger.info(`[FollowUp] ${deleted} follow-up lama (>7 hari) dibersihkan.`);
  }
}

export function emitFollowUpUpdate(storeWaId: string): void {
  if (ioRef) {
    ioRef.emit('followUpUpdated', { storeWaId });
  }
}
