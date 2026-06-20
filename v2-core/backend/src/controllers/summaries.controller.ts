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
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));

    const where: any = {};
    if (store_wa_id) where.store_wa_id = store_wa_id;

    // Build search condition for database-level filtering
    if (search) {
      const q = (search as string).toLowerCase();
      where[Op.or as any] = [
        { contact_name: { [Op.like]: `%${q}%` } },
        { contact_phone: { [Op.like]: `%${q}%` } },
        { contact_id: { [Op.like]: `%${q}%` } }
      ];
    }

    // For label filtering, we still need in-memory since wa_labels is JSON
    // But we can use database pagination first, then filter by label
    let allSummaries: any[];
    let total: number;

    if (label && label !== 'semua') {
      // Label filter requires in-memory JSON parse
      // But limit to last 500 records for performance
      allSummaries = await ChatSummary.findAll({
        where,
        order: [['last_updated', 'DESC']],
        limit: 500  // Cap at 500 to prevent memory issues
      });

      allSummaries = allSummaries.filter(s => {
        try {
          const labels: string[] = JSON.parse((s as any).wa_labels || '[]');
          return labels.some((l: string) => l.toLowerCase() === (label as string).toLowerCase());
        } catch { return false; }
      });
      total = allSummaries.length;
    } else {
      // No label filter — use proper DB pagination
      total = await ChatSummary.count({ where });
      allSummaries = await ChatSummary.findAll({
        where,
        order: [['last_updated', 'DESC']],
        offset: (pageNum - 1) * limitNum,
        limit: limitNum
      });
    }

    const totalPages = Math.ceil(total / limitNum) || 1;
    const data = label && label !== 'semua'
      ? allSummaries.slice((pageNum - 1) * limitNum, pageNum * limitNum)
      : allSummaries;

    // Attach store name — batch load only needed stores
    const storeIds = [...new Set(data.map(s => s.store_wa_id))];
    const stores: any[] = await Store.findAll({
      where: { wa_id: { [Op.in]: storeIds } },
      attributes: ['wa_id', 'name']
    });
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

    // Get recent messages for context (including media type messages)
    const messages = await ChatMessage.findAll({
      where: { store_wa_id: storeWaId, contact_id: contactId },
      order: [['timestamp', 'DESC']],
      limit: 100
    });

    // FIX SUK-59 #4: Get media assets related to this contact
    // Look for [MEDIA:/uploads/...] references in message bodies (bukti transfer)
    const mediaMessages = messages.filter(m => {
      const body = (m as any).body || '';
      return /\[MEDIA:\/uploads\/[^\]]+\]/.test(body);
    });
    
    const mediaAssets = mediaMessages.map(m => ({
      id: (m as any).id,
      type: 'image' as const,
      body: (m as any).body || '',
      media_path: ((m as any).body || '').match(/\[MEDIA:(\/uploads\/[^\]]+)\]/)?.[1] || null,
      timestamp: (m as any).timestamp,
      sender_name: (m as any).sender_name,
      is_from_me: (m as any).is_from_me,
      wa_message_id: (m as any).wa_message_id
    }));

    let labels: string[] = [];
    try { labels = JSON.parse((summary as any).wa_labels || '[]'); } catch {}

    res.json({
      ...summary.toJSON(),
      wa_labels: labels,
      messages: messages.reverse(),
      mediaAssets  // FIX SUK-59 #4: include media for bukti transfer display
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
