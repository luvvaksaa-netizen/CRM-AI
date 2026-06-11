import { Request, Response, NextFunction } from 'express';
import { FollowUp, Store } from '../models';
import { getFollowUps, cancelFollowUpById, getFollowUpConfig, getFollowUpStats } from '../services/followup.service';

export const getStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getFollowUpStats(String(req.params.storeId));
    res.json(stats);
  } catch (e) {
    next(e);
  }
};

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, page, limit } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 30));

    const all = await getFollowUps(String(req.params.storeId), {
      status: String(status) || undefined,
      limit: 9999
    });

    const total = all.length;
    const totalPages = Math.ceil(total / limitNum) || 1;
    const data = all.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({ data, total, page: pageNum, totalPages, limit: limitNum });
  } catch (e) {
    next(e);
  }
};

export const cancelFollowUp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const success = await cancelFollowUpById(Number(req.params.id));
    if (success) {
      res.json({ success: true, message: 'Follow-up berhasil dibatalkan.' });
    } else {
      res.status(400).json({ success: false, message: 'Follow-up tidak ditemukan atau sudah tidak pending.' });
    }
  } catch (e) {
    next(e);
  }
};

export const emergencyCancelAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [updated] = await FollowUp.update(
      { status: 'cancelled', cancel_reason: 'Emergency cancel by system' },
      { where: { status: 'pending' } }
    );
    res.json({ success: true, updated });
  } catch (e) {
    next(e);
  }
};

export const getConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await getFollowUpConfig(String(req.params.id));
    res.json(config);
  } catch (e) {
    next(e);
  }
};

export const updateConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wa_id = req.params.id;
    const { config } = req.body;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ success: false, message: 'Format config tidak valid' });
    }
    const store: any = await Store.findOne({ where: { wa_id } });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store tidak ditemukan' });
    }
    // Type definition fallback for legacy columns
    store.setDataValue('followup_config', JSON.stringify(config));
    await store.save();
    res.json({ success: true, message: 'Konfigurasi Follow-Up berhasil disimpan' });
  } catch (e) {
    next(e);
  }
};

/**
 * 4-Stage Pipeline Management
 */

export const getPipeline = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wa_id = req.params.id;
    const store: any = await Store.findOne({ where: { wa_id } });
    if (!store) return res.status(404).json({ error: 'Store tidak ditemukan' });

    // Load config from DB or use default
    let config: any = null;
    try {
      if (store.followup_config) {
        config = JSON.parse(store.followup_config);
      }
    } catch {}

    if (!config || !config['1']) {
      // Load default from legacy service
      try {
        const path = require('path');
        const followupService = require('../services/followup.service');
        config = followupService.DEFAULT_FOLLOWUP_CONFIG;
      } catch {
        config = {
          1: { delay_minutes: 10, media_type: 'video', media_label_hints: ['video', 'produk'], ai_instruction: 'Sapa ramah, tawarkan video produk.' },
          2: { delay_minutes: 60, media_type: 'image', media_label_hints: ['value', 'testimoni'], ai_instruction: 'Berikan keunggulan produk.' },
          3: { scheduled_hour: 19, media_type: 'video', media_label_hints: ['video'], ai_instruction: 'Ingatkan pesan malam ini.' },
          4: { scheduled_hour: 6, scheduled_next_day: true, media_type: 'mixed', media_label_hints: ['testimoni', 'review'], ai_instruction: 'Selamat pagi, tanyakan minat.' }
        };
      }
    }

    res.json({ config, store_wa_id: wa_id });
  } catch (e) {
    next(e);
  }
};

export const updatePipeline = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wa_id = req.params.id;
    const { config } = req.body;

    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'Config harus berupa object dengan key stage 1-4' });
    }

    const store: any = await Store.findOne({ where: { wa_id } });
    if (!store) return res.status(404).json({ error: 'Store tidak ditemukan' });

    store.setDataValue('followup_config', JSON.stringify(config));
    await store.save();

    res.json({ success: true, message: 'Pipeline follow-up berhasil diupdate.', config });
  } catch (e) {
    next(e);
  }
};

export const forceSendNow = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const followUpId = parseInt(String(req.params.id));
    const fu: any = await FollowUp.findByPk(followUpId);
    if (!fu) return res.status(404).json({ error: 'Follow-up tidak ditemukan' });

    // Set scheduled_at to now so scheduler picks it up immediately
    await fu.update({ scheduled_at: new Date() });

    // Try to execute immediately via legacy service
    try {
      const path = require('path');
      const followupService = require('../services/followup.service');
      // We can't directly call executeFollowUp (internal), so we just reschedule
    } catch {}

    res.json({ success: true, message: 'Follow-up dijadwalkan segera. Scheduler akan mengirim dalam < 60 detik.' });
  } catch (e) {
    next(e);
  }
};

export const scheduleManual = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_wa_id, contact_id, contact_name, stage, scheduled_at, last_chat_context } = req.body;

    if (!store_wa_id || !contact_id) {
      return res.status(400).json({ error: 'store_wa_id dan contact_id wajib diisi' });
    }

    const followUp = await FollowUp.create({
      store_wa_id,
      contact_id,
      contact_name: contact_name || 'Pelanggan',
      stage: stage || 1,
      scheduled_at: scheduled_at ? new Date(scheduled_at) : new Date(Date.now() + 10 * 60 * 1000),
      status: 'pending',
      last_chat_context: last_chat_context || ''
    });

    res.json({ success: true, followUp, message: 'Follow-up manual berhasil dijadwalkan.' });
  } catch (e) {
    next(e);
  }
};

export const getStageStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_wa_id } = req.params;

    const stageCounts: Record<number, { pending: number; sent: number; replied: number; cancelled: number }> = {};

    for (let stage = 1; stage <= 4; stage++) {
      const [pending, sent, replied, cancelled] = await Promise.all([
        FollowUp.count({ where: { store_wa_id, stage, status: 'pending' } }),
        FollowUp.count({ where: { store_wa_id, stage, status: 'sent' } }),
        FollowUp.count({ where: { store_wa_id, stage, status: 'replied' } }),
        FollowUp.count({ where: { store_wa_id, stage, status: 'cancelled' } })
      ]);
      stageCounts[stage] = { pending, sent, replied, cancelled };
    }

    res.json({ stageCounts, store_wa_id });
  } catch (e) {
    next(e);
  }
};

