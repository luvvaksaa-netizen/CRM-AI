import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { ChatSummary, ChatMessage, Store } from '../models';

/**
 * Summaries Controller — Rekap Pembahasan
 * Menampilkan ringkasan percakapan AI per kontak.
 */

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_wa_id, label, search, page, limit } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 30));

    const where: any = {};
    if (store_wa_id) where.store_wa_id = store_wa_id;

    const allSummaries: any[] = await ChatSummary.findAll({
      where,
      order: [['last_updated', 'DESC']]
    });

    // Filter by label (wa_labels contains the label)
    let filtered = allSummaries;
    if (label && label !== 'semua') {
      filtered = allSummaries.filter(s => {
        try {
          const labels: string[] = JSON.parse((s as any).wa_labels || '[]');
          return labels.some((l: string) => l.toLowerCase() === (label as string).toLowerCase());
        } catch { return false; }
      });
    }

    // Search by name, phone, or contact ID
    if (search) {
      const q = (search as string).toLowerCase();
      filtered = filtered.filter(s =>
        (s.contact_name || '').toLowerCase().includes(q) ||
        (s.contact_phone || '').includes(q) ||
        (s.contact_id || '').includes(q)
      );
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / limitNum) || 1;
    const data = filtered.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    // Attach store name
    const stores: any[] = await Store.findAll({ attributes: ['wa_id', 'name'] });
    const storeMap: Record<string, string> = {};
    for (const st of stores) storeMap[st.wa_id] = st.name;

    const result = data.map(s => {
      let labels: string[] = [];
      try { labels = JSON.parse((s as any).wa_labels || '[]'); } catch {}
      return {
        ...s.toJSON(),
        store_name: storeMap[s.store_wa_id] || 'Unknown',
        wa_labels: labels
      };
    });

    res.json({ data: result, total, page: pageNum, totalPages, limit: limitNum });
  } catch (e) {
    next(e);
  }
};

export const getById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeWaId, contactId } = req.params;
    const summary = await ChatSummary.findOne({
      where: { store_wa_id: storeWaId, contact_id: contactId }
    });
    if (!summary) return res.status(404).json({ error: 'Rekap tidak ditemukan' });

    // Get recent messages for context
    const messages = await ChatMessage.findAll({
      where: { store_wa_id: storeWaId, contact_id: contactId },
      order: [['timestamp', 'DESC']],
      limit: 100
    });

    let labels: string[] = [];
    try { labels = JSON.parse((summary as any).wa_labels || '[]'); } catch {}

    res.json({
      ...summary.toJSON(),
      wa_labels: labels,
      messages: messages.reverse()
    });
  } catch (e) {
    next(e);
  }
};

export const getLabelSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_wa_id } = req.query;
    const where: any = {};
    if (store_wa_id) where.store_wa_id = store_wa_id;

    const allSummaries: any[] = await ChatSummary.findAll({ where });

    const labelCounts: Record<string, number> = {};
    for (const s of allSummaries) {
      try {
        const labels: string[] = JSON.parse((s as any).wa_labels || '[]');
        for (const l of labels) {
          labelCounts[l] = (labelCounts[l] || 0) + 1;
        }
      } catch {}
    }

    const total = allSummaries.length;
    const labelled = allSummaries.filter(s => {
      try { return JSON.parse((s as any).wa_labels || '[]').length > 0; } catch { return false; }
    }).length;

    res.json({ labelCounts, total, labelled, unlabelled: total - labelled });
  } catch (e) {
    next(e);
  }
};
