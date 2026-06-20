import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { ChatSummary, ChatMessage, Store, FollowUp, ClosingAnalytic } from '../models';

const LABEL_NAMES: Record<string, string> = {
  closing: 'Closing', 
  menunggu_transfer: 'Menunggu Transfer',
  menunggu_rekap: 'Menunggu Rekap', 
  menunggu_alamat: 'Menunggu Alamat',
  negosiasi: 'Hot Lead', 
  gali_kebutuhan: 'AI Lead Aktif', 
  opening: 'AI Lead Baru'
};

const STATUS_REGEX_FALLBACK: Record<string, RegExp> = {
  closing:           /status:\s*(closing|selesai)/i,
  menunggu_transfer: /status:\s*menunggu\s*transfer/i,
  menunggu_rekap:    /status:\s*menunggu\s*rekap/i,
  menunggu_alamat:   /status:\s*menunggu\s*alamat/i,
  negosiasi:         /status:\s*negosiasi/i,
  gali_kebutuhan:    /status:\s*gali\s*kebutuhan/i,
  opening:           /status:\s*opening/i,
};

function detectStatus(record: any): string | null {
  let labels: string[] = [];
  try { labels = JSON.parse(record.wa_labels || '[]'); } catch(_){}
  if (labels.length > 0) {
    for (const [key, labelName] of Object.entries(LABEL_NAMES)) {
      if (labels.includes(labelName)) return key;
    }
  }
  const txt = record.summary || '';
  for (const [key, re] of Object.entries(STATUS_REGEX_FALLBACK)) {
    if (re.test(txt)) return key;
  }
  return null;
}

// Helper: bangun date range dari params
function parseDateRange(query: any): { sDateMs: number; eDateMs: number } {
  const { startDate, endDate } = query;
  const sDateMs = startDate ? new Date(startDate as string).getTime() : 0;
  const eDateMs = endDate   ? new Date(endDate as string).getTime()   : Infinity;
  return { sDateMs, eDateMs };
}

// Helper: bangun array tanggal untuk trend chart berdasarkan range aktif
function buildTrendMap(sDateMs: number, eDateMs: number): Record<string, { date: string; leads: number; closing: number }> {
  const trendMap: Record<string, { date: string; leads: number; closing: number }> = {};
  const now = Date.now();
  const eDateCapped = Math.min(eDateMs === Infinity ? now : eDateMs, now);
  const sDateCapped = sDateMs === 0 ? now - 30 * 24 * 60 * 60 * 1000 : sDateMs;

  // Hitung jumlah hari dalam range, maks 90 hari
  const diffMs = eDateCapped - sDateCapped;
  const diffDays = Math.min(Math.ceil(diffMs / (24 * 60 * 60 * 1000)), 90);
  const days = Math.max(diffDays, 1);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(eDateCapped);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    trendMap[key] = { date: key, leads: 0, closing: 0 };
  }
  return trendMap;
}

export const getOverview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_wa_id } = req.query;
    const { sDateMs, eDateMs } = parseDateRange(req.query);

    const summaryWhere: any = {};
    const msgWhere: any = {};
    if (store_wa_id) {
      summaryWhere.store_wa_id = store_wa_id;
      msgWhere.store_wa_id = store_wa_id;
    }

    // Filter pesan berdasarkan timestamp
    if (sDateMs > 0 || eDateMs < Infinity) {
      msgWhere.timestamp = {};
      if (sDateMs > 0) msgWhere.timestamp[Op.gte] = new Date(sDateMs);
      if (eDateMs < Infinity) msgWhere.timestamp[Op.lte] = new Date(eDateMs);
    }

    const allSummaries: any[] = await ChatSummary.findAll({ where: summaryWhere });

    const statusCounts: Record<string, number> = Object.fromEntries(Object.keys(LABEL_NAMES).map(k => [k, 0]));
    let totalLeads = 0;

    for (const s of allSummaries) {
      const createdTime = new Date(s.createdAt).getTime();
      // Leads = kontak yang pertama kali muncul (ChatSummary dibuat) dalam range
      if (createdTime >= sDateMs && createdTime <= eDateMs) {
        totalLeads++;
      }

      let ts: any = {};
      try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}
      let hasLabelTimestamp = false;
      
      for (const [key, labelName] of Object.entries(LABEL_NAMES)) {
        if (ts[labelName]) {
          hasLabelTimestamp = true;
          if (ts[labelName] >= sDateMs && ts[labelName] <= eDateMs) {
            statusCounts[key]++;
          }
        }
      }

      if (!hasLabelTimestamp) {
        const status = detectStatus(s);
        if (status) {
          const fallbackTime = new Date(s.last_updated || s.createdAt).getTime();
          if (fallbackTime >= sDateMs && fallbackTime <= eDateMs) {
            statusCounts[status]++;
          }
        }
      }
    }

    const closingRate = totalLeads > 0 ? Math.round((statusCounts.closing / totalLeads) * 100) : 0;

    const aiReplyCount = await ChatMessage.count({
      where: { ...msgWhere, is_from_me: true, sender_name: { [Op.not]: 'CS (dari HP)' } }
    });
    const csManualCount = await ChatMessage.count({
      where: { ...msgWhere, is_from_me: true, sender_name: 'CS (dari HP)' }
    });
    const totalOut = aiReplyCount + csManualCount;
    const aiHandlingRate = totalOut > 0 ? Math.round((aiReplyCount / totalOut) * 100) : 0;

    // Trend chart — respek date filter
    const trendMap = buildTrendMap(sDateMs, eDateMs);
    for (const s of allSummaries) {
      const dayKey = new Date(s.createdAt).toISOString().slice(0, 10);
      if (trendMap[dayKey]) trendMap[dayKey].leads++;
      
      let ts: any = {};
      try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}
      if (ts['Closing']) {
          const closeKey = new Date(ts['Closing']).toISOString().slice(0, 10);
          if (trendMap[closeKey]) trendMap[closeKey].closing++;
      } else {
          if (detectStatus(s) === 'closing') {
              const closeKey = new Date(s.last_updated || s.createdAt).toISOString().slice(0, 10);
              if (trendMap[closeKey]) trendMap[closeKey].closing++;
          }
      }
    }
    const trend = Object.values(trendMap);

    // Per-store breakdown
    const storesToProcess: any[] = store_wa_id 
      ? await Store.findAll({ where: { wa_id: store_wa_id }, attributes: ['wa_id', 'name'] })
      : await Store.findAll({ attributes: ['wa_id', 'name'] });

    const perStore = [];
    for (const store of storesToProcess) {
      const storeSum = store_wa_id ? allSummaries : allSummaries.filter(s => s.store_wa_id === store.wa_id);
      let storeTotalLeads = 0, storeClosing = 0;
      for (const s of storeSum) {
        const ct = new Date(s.createdAt).getTime();
        if (ct >= sDateMs && ct <= eDateMs) storeTotalLeads++;
        
        let ts: any = {};
        try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}
        if (ts['Closing']) {
          if (ts['Closing'] >= sDateMs && ts['Closing'] <= eDateMs) storeClosing++;
        } else {
          if (detectStatus(s) === 'closing') {
            const labelTime = new Date(s.last_updated || s.createdAt).getTime();
            if (labelTime >= sDateMs && labelTime <= eDateMs) storeClosing++;
          }
        }
      }
      
      perStore.push({
        name: store.name,
        leads: storeTotalLeads,
        closing: storeClosing,
        closingRate: storeTotalLeads > 0 ? Math.round((storeClosing/storeTotalLeads)*100) : 0
      });
    }

    res.json({
      totalLeads, closingRate, aiHandlingRate,
      aiReplyCount, csManualCount,
      statusBreakdown: statusCounts, trend, perStore
    });

  } catch (e) {
    next(e);
  }
};

export const getLeads = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_wa_id, label } = req.query;
    const { sDateMs, eDateMs } = parseDateRange(req.query);

    // Default: tampilkan semua leads baru (baru_masuk) jika tidak ada label
    const effectiveLabel = (label as string) || 'baru_masuk';

    const summaryWhere: any = {};
    if (store_wa_id) summaryWhere.store_wa_id = store_wa_id;

    const allSummaries: any[] = await ChatSummary.findAll({ where: summaryWhere });
    const stores: any[] = await Store.findAll({ attributes: ['wa_id', 'name'] });
    const storeMap: Record<string, string> = {};
    for (const st of stores) storeMap[st.wa_id] = st.name;

    const leads: any[] = [];

    for (const s of allSummaries) {
      if (effectiveLabel === 'baru_masuk') {
        // Leads baru = ChatSummary dibuat (pertama kali chat) dalam range
        const ct = new Date(s.createdAt).getTime();
        if (ct >= sDateMs && ct <= eDateMs) leads.push(s);
        continue;
      }

      const targetLabelName = LABEL_NAMES[effectiveLabel];
      if (!targetLabelName) continue;

      let ts: any = {};
      try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}

      let hasLabelTimestamp = !!ts[targetLabelName];
      let labelTime = ts[targetLabelName];

      if (!hasLabelTimestamp) {
        let matchedLabels: string[] = [];
        try { matchedLabels = JSON.parse(s.wa_labels || '[]'); } catch(_){}
        let hasLabel = matchedLabels.includes(targetLabelName);
        if (!hasLabel && STATUS_REGEX_FALLBACK[effectiveLabel]) {
          hasLabel = STATUS_REGEX_FALLBACK[effectiveLabel].test(s.summary || '');
        }
        if (hasLabel) {
          labelTime = new Date(s.last_updated || s.createdAt).getTime();
          hasLabelTimestamp = true;
        }
      }

      if (hasLabelTimestamp && labelTime >= sDateMs && labelTime <= eDateMs) {
        leads.push(s);
      }
    }

    leads.sort((a, b) => new Date(b.last_updated || b.createdAt).getTime() - new Date(a.last_updated || a.createdAt).getTime());

    const result = leads.slice(0, 100).map(s => ({
      store_wa_id: s.store_wa_id,
      store_name: storeMap[s.store_wa_id] || 'Unknown Store',
      contact_id: s.contact_id,
      contact_name: s.contact_name || 'Pelanggan',
      contact_phone: s.contact_phone,
      last_updated: s.last_updated || s.createdAt,
      created_at: s.createdAt,
    }));

    res.json(result);
  } catch (e) {
    next(e);
  }
};

export const getFollowups = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_wa_id } = req.query;
    const stores: any[] = await Store.findAll({ attributes: ['wa_id', 'name'] });
    const result = [];

    for (const store of stores) {
      if (store_wa_id && store.wa_id !== store_wa_id) continue;
      const [pending, sent, replied, cancelled] = await Promise.all([
        FollowUp.count({ where: { store_wa_id: store.wa_id, status: 'pending' } }),
        FollowUp.count({ where: { store_wa_id: store.wa_id, status: 'sent' } }),
        FollowUp.count({ where: { store_wa_id: store.wa_id, status: 'replied' } }),
        FollowUp.count({ where: { store_wa_id: store.wa_id, status: 'cancelled' } })
      ]);
      const total = pending + sent + replied + cancelled;
      if (total > 0) {
        result.push({ wa_id: store.wa_id, name: store.name, pending, sent, replied, cancelled, total });
      }
    }

    res.json(result);
  } catch (e) {
    next(e);
  }
};

export const getLearning = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_wa_id, limit = 50 } = req.query;
    const whereClause = store_wa_id ? { store_wa_id } : {};
    const analytics = await ClosingAnalytic.findAll({
      where: whereClause,
      order: [['analyzed_at', 'DESC']],
      limit: parseInt(limit as string, 10)
    });
    res.json(analytics);
  } catch (e) {
    next(e);
  }
};
