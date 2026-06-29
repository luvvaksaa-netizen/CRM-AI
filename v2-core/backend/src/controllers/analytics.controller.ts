import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { ChatSummary, ChatMessage, Store, FollowUp, ClosingAnalytic } from '../models';

const LABEL_NAMES: Record<string, string> = {
  closing: 'Closing', 
  transfer: 'Transfer',
  cod: 'COD',
};

const STATUS_REGEX_FALLBACK: Record<string, RegExp> = {
  closing:           /status:\s*(closing|selesai)/i,
  transfer:          /status:\s*transfer/i,
  cod:               /status:\s*cod/i,
};

function detectStatus(record: any): string | null {
  let labels: string[] = [];
  try { labels = JSON.parse(record.wa_labels || '[]'); } catch(_){}
  if (labels.length > 0) {
    const lowerLabels = labels.map(l => l.toLowerCase());
    for (const [key, labelName] of Object.entries(LABEL_NAMES)) {
      if (lowerLabels.includes(labelName.toLowerCase())) return key;
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

      let ts: Record<string, number> = {};
      try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}
      
      // Normalize keys to lowercase to handle "CLOSING" vs "Closing"
      const normalizedTs: Record<string, number> = {};
      for (const [k, v] of Object.entries(ts)) {
        normalizedTs[k.toLowerCase()] = v;
      }

      let hasLabelTimestamp = false;
      
      for (const [key, labelName] of Object.entries(LABEL_NAMES)) {
        const tsValue = normalizedTs[labelName.toLowerCase()];
        if (tsValue) {
          hasLabelTimestamp = true;
          if (tsValue >= sDateMs && tsValue <= eDateMs) {
            statusCounts[key]++;
          }
        }
      }

      if (!hasLabelTimestamp) {
        const status = detectStatus(s);
        if (status) {
          const fallbackTime = new Date(s.createdAt).getTime(); // strict idempotency
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
    
    // Helper to get local YYYY-MM-DD from timestamp assuming +07:00 (or server timezone)
    // To make it perfectly align with milliseconds bounds, we just create a Date object and format it locally
    const getLocalYYYYMMDD = (ms: number) => {
        const d = new Date(ms);
        // Using Swedish locale (sv-SE) produces YYYY-MM-DD locally
        return d.toLocaleDateString('sv-SE');
    };

    for (const s of allSummaries) {
      const dayKey = getLocalYYYYMMDD(new Date(s.createdAt).getTime());
      if (trendMap[dayKey]) trendMap[dayKey].leads++;
      
      let ts: Record<string, number> = {};
      try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}
      const normalizedTs: Record<string, number> = {};
      for (const [k, v] of Object.entries(ts)) {
        normalizedTs[k.toLowerCase()] = v;
      }

      if (normalizedTs['closing']) {
          const closeKey = getLocalYYYYMMDD(normalizedTs['closing']);
          if (trendMap[closeKey]) trendMap[closeKey].closing++;
      } else {
          if (detectStatus(s) === 'closing') {
              const closeKey = getLocalYYYYMMDD(new Date(s.createdAt).getTime());
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
        
        let ts: Record<string, number> = {};
        try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}
        const normalizedTs: Record<string, number> = {};
        for (const [k, v] of Object.entries(ts)) {
          normalizedTs[k.toLowerCase()] = v;
        }

        if (normalizedTs['closing']) {
          if (normalizedTs['closing'] >= sDateMs && normalizedTs['closing'] <= eDateMs) storeClosing++;
        } else {
          if (detectStatus(s) === 'closing') {
            const labelTime = new Date(s.createdAt).getTime();
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

    const effectiveLabel = (label as string) || 'baru_masuk';

    const summaryWhere: any = {};
    if (store_wa_id) summaryWhere.store_wa_id = store_wa_id;

    const allSummaries: any[] = await ChatSummary.findAll({ where: summaryWhere });
    const storeList: any[] = await Store.findAll({ attributes: ['wa_id', 'name'] });
    const storeMap: Record<string, string> = {};
    for (const st of storeList) storeMap[st.wa_id] = st.name;

    const leads: any[] = [];

    for (const s of allSummaries) {
      if (effectiveLabel === 'baru_masuk') {
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

    const result = leads.slice(0, 100).map(s => {
      let phoneDisplay = s.contact_phone ? `+${s.contact_phone}` : null;
      if (!phoneDisplay && s.contact_id) {
        if (s.contact_id.endsWith('@c.us')) {
          phoneDisplay = `+${s.contact_id.replace('@c.us', '')}`;
        } else {
          const digits = s.contact_id.replace('@lid', '').replace(/\D/g, '');
          phoneDisplay = digits ? `LID-${digits.slice(-6)}` : s.contact_id;
        }
      }
      return {
        store_wa_id: s.store_wa_id,
        store_name: storeMap[s.store_wa_id] || 'Unknown Store',
        contact_id: s.contact_id,
        contact_name: (!s.contact_name || /^Kontak WA/.test(s.contact_name)) ? null : s.contact_name,
        contact_phone: phoneDisplay,
        last_updated: s.last_updated || s.createdAt,
        created_at: s.createdAt,
      };
    });

    res.json(result);
  } catch (e) {
    next(e);
  }
};

/**
 * GET /analytics/closing
 * Daftar kontak yang sudah mendapat label CLOSING dalam rentang waktu.
 * Sumber data: label_timestamps['Closing'] → wa_labels → regex di summary
 * Memberikan full traceability: nomor WA, toko, waktu closing.
 */
export const getClosing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_wa_id } = req.query;
    const { sDateMs, eDateMs } = parseDateRange(req.query);

    const summaryWhere: any = {};
    if (store_wa_id) summaryWhere.store_wa_id = store_wa_id;

    const allSummaries: any[] = await ChatSummary.findAll({ where: summaryWhere });
    const storeList: any[] = await Store.findAll({ attributes: ['wa_id', 'name'] });
    const storeMap: Record<string, string> = {};
    for (const st of storeList) storeMap[st.wa_id] = st.name;

    const closingList: any[] = [];

    for (const s of allSummaries) {
      let closingTime: number | null = null;

      // Prioritas 1: label_timestamps['Closing'] — paling akurat
      let ts: any = {};
      try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}
      if (ts['Closing'] && typeof ts['Closing'] === 'number') {
        closingTime = ts['Closing'];
      }

      // Prioritas 2: wa_labels JSON array berisi 'Closing'
      if (closingTime === null) {
        let labels: string[] = [];
        try { labels = JSON.parse(s.wa_labels || '[]'); } catch(_){}
        if (labels.some(l => l.toLowerCase() === 'closing')) {
          closingTime = new Date(s.last_updated || s.createdAt).getTime();
        }
      }

      // Prioritas 3: regex di summary
      if (closingTime === null && STATUS_REGEX_FALLBACK.closing.test(s.summary || '')) {
        closingTime = new Date(s.last_updated || s.createdAt).getTime();
      }

      if (closingTime !== null && closingTime >= sDateMs && closingTime <= eDateMs) {
        let phoneDisplay = s.contact_phone ? `+${s.contact_phone}` : null;
        if (!phoneDisplay && s.contact_id) {
          if (s.contact_id.endsWith('@c.us')) {
            phoneDisplay = `+${s.contact_id.replace('@c.us', '')}`;
          } else {
            const digits = s.contact_id.replace('@lid', '').replace(/\D/g, '');
            phoneDisplay = digits ? `LID-${digits.slice(-6)}` : s.contact_id;
          }
        }

        closingList.push({
          store_wa_id: s.store_wa_id,
          store_name: storeMap[s.store_wa_id] || 'Unknown Store',
          contact_id: s.contact_id,
          contact_name: (!s.contact_name || /^Kontak WA/.test(s.contact_name)) ? null : s.contact_name,
          contact_phone: phoneDisplay,
          closing_at: new Date(closingTime).toISOString(),
          last_updated: s.last_updated || s.createdAt,
        });
      }
    }

    closingList.sort((a, b) => new Date(b.closing_at).getTime() - new Date(a.closing_at).getTime());

    res.json(closingList.slice(0, 200));
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
