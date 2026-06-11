import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { ClosingPattern, ClosingAnalytic, ChatSummary, BotAgent, Store } from '../models';

/**
 * Closing Controller — Closing Management
 * Menampilkan data closing, analytics, dan closing patterns.
 */

// Helper: build filter object dari query params
const buildFilter = (query: any) => {
  const { store_wa_id, agent_id, product_type, metode_bayar, start_date, end_date } = query;
  const where: any = {};
  if (agent_id) where.agent_id = agent_id;
  if (store_wa_id) where.store_wa_id = store_wa_id;
  // product_type: trim whitespace, ignore 'semua' dan string kosong
  if (product_type && typeof product_type === 'string') {
    const pt = product_type.trim();
    if (pt && pt !== 'semua') where.product_type = pt;
  }
  // metode_bayar: trim whitespace, ignore 'semua' dan string kosong
  if (metode_bayar && typeof metode_bayar === 'string') {
    const mb = metode_bayar.trim();
    if (mb && mb !== 'semua') where.metode_bayar = mb;
  }
  if (start_date || end_date) {
    where.analyzed_at = {};
    if (start_date && typeof start_date === 'string') where.analyzed_at[Op.gte] = new Date(start_date.trim());
    if (end_date && typeof end_date === 'string') where.analyzed_at[Op.lte] = new Date(end_date.trim());
  }
  return where;
};

export const getStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const where = buildFilter(req.query);

    const totalClosings = await ClosingAnalytic.count({ where });
    const qualifiedClosings = await ClosingAnalytic.count({
      where: { ...where, conversation_score: { [Op.gte]: 6.0 } }
    });

    // Per-product type breakdown
    const productTypes = await ClosingAnalytic.findAll({
      attributes: ['product_type'],
      where,
      group: ['product_type'],
    });

    const productBreakdown: Record<string, number> = {};
    for (const pt of productTypes) {
      productBreakdown[(pt as any).product_type] = await ClosingAnalytic.count({
        where: { ...where, product_type: (pt as any).product_type }
      });
    }

    // COD vs Transfer breakdown
    const codCount = await ClosingAnalytic.count({ where: { ...where, metode_bayar: 'COD' } });
    const transferCount = await ClosingAnalytic.count({ where: { ...where, metode_bayar: 'Transfer' } });

    const avgScore = await ClosingAnalytic.findOne({
      attributes: [[(ClosingAnalytic.sequelize as any).fn('AVG', (ClosingAnalytic.sequelize as any).col('conversation_score')), 'avg']],
      where
    });

    res.json({
      totalClosings,
      qualifiedClosings,
      productBreakdown,
      codCount,
      transferCount,
      avgScore: avgScore ? Math.round(((avgScore as any).getDataValue('avg') || 0) * 10) / 10 : 0
    });
  } catch (e) {
    next(e);
  }
};

export const getPatterns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { agent_id, product_type, limit } = req.query;
    const where: any = { is_active: true };

    if (agent_id) where.agent_id = agent_id;
    if (product_type && typeof product_type === 'string') {
      const pt = product_type.trim();
      if (pt && pt !== 'semua') where.product_type = pt;
    }

    const patterns = await ClosingPattern.findAll({
      where,
      order: [['confidence', 'DESC'], ['frequency', 'DESC']],
      limit: parseInt(limit as string) || 50
    });

    res.json({ data: patterns, total: patterns.length });
  } catch (e) {
    next(e);
  }
};

export const getAnalytics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 30));

    const where = buildFilter(req.query);

    const total = await ClosingAnalytic.count({ where });
    const data = await ClosingAnalytic.findAll({
      where,
      order: [['analyzed_at', 'DESC']],
      offset: (pageNum - 1) * limitNum,
      limit: limitNum,
      include: [
        {
          model: ChatSummary,
          required: false,
          attributes: ['summary', 'contact_name', 'contact_phone', 'last_updated']
        },
        {
          model: Store,
          required: false,
          attributes: ['name', 'wa_id']
        }
      ]
    });

    res.json({
      data,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      limit: limitNum
    });
  } catch (e) {
    next(e);
  }
};

export const togglePatternActive = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pattern = await ClosingPattern.findByPk(req.params.id as any);
    if (!pattern) return res.status(404).json({ error: 'Pattern tidak ditemukan' });

    (pattern as any).is_active = !(pattern as any).is_active;
    await pattern.save();

    res.json({ success: true, pattern });
  } catch (e) {
    next(e);
  }
};

export const deletePattern = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pattern = await ClosingPattern.findByPk(req.params.id as any);
    if (!pattern) return res.status(404).json({ error: 'Pattern tidak ditemukan' });

    await pattern.destroy();
    res.json({ success: true, message: 'Pattern berhasil dihapus.' });
  } catch (e) {
    next(e);
  }
};

// ─── CSV Export ──────────────────────────────────────────────────

export const exportCsv = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const where = buildFilter(req.query);

    const data: any[] = await ClosingAnalytic.findAll({
      where,
      order: [['analyzed_at', 'DESC']],
      limit: 10000,
      include: [
        {
          model: ChatSummary,
          required: false,
          attributes: ['summary', 'contact_name']
        }
      ]
    });

    // Build CSV
    const headers = [
      'ID', 'Store WA ID', 'Contact ID', 'Contact Name', 'Product Type',
      'Score', 'Messages to Close', 'Payment Method', 'Full Flow',
      'Complete Data', 'Patterns Extracted', 'Summary', 'Analyzed At'
    ];
    const rows = data.map((d: any) => [
      d.id,
      d.store_wa_id || '',
      d.contact_id || '',
      (d.ChatSummary as any)?.contact_name || '',
      d.product_type || '',
      d.conversation_score || 0,
      d.pesan_sampai_closing || 0,
      d.metode_bayar || '',
      d.alur_lengkap ? 'Yes' : 'No',
      d.data_lengkap ? 'Yes' : 'No',
      d.patterns_extracted || 0,
      (d.ChatSummary as any)?.summary || '',
      d.analyzed_at ? new Date(d.analyzed_at).toISOString() : '',
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="closing_export_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('\uFEFF' + csvContent); // BOM untuk Excel
  } catch (e) {
    next(e);
  }
};
