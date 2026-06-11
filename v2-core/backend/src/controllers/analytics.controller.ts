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

export const getOverview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_wa_id, startDate, endDate } = req.query;

    const summaryWhere: any = {};
    const msgWhere: any = {};
    if (store_wa_id) {
      summaryWhere.store_wa_id = store_wa_id;
      msgWhere.store_wa_id = store_wa_id;
    }
    if (startDate && endDate) {
      msgWhere.timestamp = { [Op.between]: [new Date(startDate as string), new Date(endDate as string)] };
    }

    const allSummaries: any[] = await ChatSummary.findAll({ where: summaryWhere });

    const sDateMs = startDate ? new Date(startDate as string).getTime() : 0;
    const eDateMs = endDate   ? new Date(endDate as string).getTime()   : Infinity;

    const statusCounts: Record<string, number> = Object.fromEntries(Object.keys(LABEL_NAMES).map(k => [k, 0]));
    let totalLeads = 0;

    for (const s of allSummaries) {
      const createdTime = new Date(s.createdAt).getTime();
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

    const trendMap: any = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      trendMap[key] = { date: key, leads: 0, closing: 0 };
    }
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

    let perStore = [];
    const storesToProcess: any[] = store_wa_id 
      ? await Store.findAll({ where: { wa_id: store_wa_id }, attributes: ['wa_id', 'name'] })
      : await Store.findAll({ attributes: ['wa_id', 'name'] });

    for (const store of storesToProcess) {
      const storeSum = store_wa_id ? allSummaries : allSummaries.filter(s => s.store_wa_id === store.wa_id);
      let storeTotalLeads = 0, storeClosing = 0;
      for (const s of storeSum) {
        if (new Date(s.createdAt).getTime() >= sDateMs && new Date(s.createdAt).getTime() <= eDateMs) storeTotalLeads++;
        
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

    const topClosing = await ChatSummary.findAll({
      where: summaryWhere,
      order: [['last_updated', 'DESC']],
      limit: 10
    });

    res.json({
      totalLeads, closingRate, aiHandlingRate,
      aiReplyCount, csManualCount,
      statusBreakdown: statusCounts, trend, perStore, topClosing
    });

  } catch (e) {
    next(e);
  }
};

export const getLeads = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { store_wa_id, label, startDate, endDate } = req.query;

    const summaryWhere: any = {};
    if (store_wa_id) summaryWhere.store_wa_id = store_wa_id;

    const allSummaries: any[] = await ChatSummary.findAll({ where: summaryWhere });
    const stores: any[] = await Store.findAll({ attributes: ['wa_id', 'name'] });
    const storeMap: Record<string, string> = {};
    for (const st of stores) storeMap[st.wa_id] = st.name;

    const sDateMs = startDate ? new Date(startDate as string).getTime() : 0;
    const eDateMs = endDate   ? new Date(endDate as string).getTime()   : Infinity;

    let leads = [];

    for (const s of allSummaries) {
      if (label === 'baru_masuk') {
        const ct = new Date(s.createdAt).getTime();
        if (ct >= sDateMs && ct <= eDateMs) leads.push(s);
        continue;
      }

      const targetLabelName = LABEL_NAMES[label as string];
      if (!targetLabelName) continue;

      let ts: any = {};
      try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}

      let hasLabelTimestamp = !!ts[targetLabelName];
      let labelTime = ts[targetLabelName];

      if (!hasLabelTimestamp) {
        let matchedLabels: string[] = [];
        try { matchedLabels = JSON.parse(s.wa_labels || '[]'); } catch(_){}
        let hasLabel = matchedLabels.includes(targetLabelName);
        if (!hasLabel && STATUS_REGEX_FALLBACK[label as string]) {
          hasLabel = STATUS_REGEX_FALLBACK[label as string].test(s.summary || '');
        }
        if (hasLabel) {
          labelTime = new Date(s.last_updated || s.createdAt).getTime();
          hasLabelTimestamp = true;
        }
      }

      if (hasLabelTimestamp) {
        if (labelTime >= sDateMs && labelTime <= eDateMs) {
          leads.push(s);
        }
      }
    }

    leads.sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime());

    const result = leads.map(s => ({
      store_wa_id: s.store_wa_id,
      store_name: storeMap[s.store_wa_id] || 'Unknown Store',
      contact_id: s.contact_id,
      contact_name: s.contact_name || 'Pelanggan',
      contact_phone: s.contact_phone,
      last_updated: s.last_updated
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
      result.push({ wa_id: store.wa_id, name: store.name, pending, sent, replied, cancelled, total: pending + sent + replied + cancelled });
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
