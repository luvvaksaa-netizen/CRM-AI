const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/services/dashboard_service.js');
let code = fs.readFileSync(filePath, 'utf8');

// Replace overview endpoint
const overviewStart = code.indexOf("app.get('/api/analytics/overview'");
const nextApiStart = code.indexOf("app.get('/api/analytics/followups'");

const newOverviewCode = `  app.get('/api/analytics/overview', async (req, res) => {
    try {
      const { ChatSummary, ChatMessage, Store } = require('../database/index');
      const { store_wa_id, startDate, endDate } = req.query;

      const summaryWhere = {};
      const msgWhere = {};
      if (store_wa_id) {
        summaryWhere.store_wa_id = store_wa_id;
        msgWhere.store_wa_id    = store_wa_id;
      }

      // Handle message filter by date for replies count
      let msgDateFilter = null;
      if (startDate && endDate) {
        msgDateFilter = {
          [require('sequelize').Op.between]: [new Date(startDate), new Date(endDate)]
        };
        msgWhere.timestamp = msgDateFilter;
      }

      const allSummaries = await ChatSummary.findAll({ where: summaryWhere });

      const LABEL_MAPPINGS = {
        closing: 'Closing',
        menunggu_transfer: 'Menunggu Transfer',
        menunggu_rekap: 'Menunggu Rekap',
        menunggu_alamat: 'Menunggu Alamat',
        negosiasi: 'Hot Lead',
        gali_kebutuhan: 'AI Lead Aktif',
        opening: 'AI Lead Baru'
      };

      const statusCounts = Object.fromEntries(Object.keys(LABEL_MAPPINGS).map(k => [k, 0]));
      
      let totalLeads = 0;

      for (const s of allSummaries) {
        // Parse timestamps
        let ts = {};
        try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(e){}
        let labels = [];
        try { labels = JSON.parse(s.wa_labels || '[]'); } catch(e){}

        // Untuk total leads (Baru Masuk), kita cek createdAt
        const createdTime = new Date(s.createdAt).getTime();
        const sDateMs = startDate ? new Date(startDate).getTime() : 0;
        const eDateMs = endDate ? new Date(endDate).getTime() : Infinity;

        if (createdTime >= sDateMs && createdTime <= eDateMs) {
          totalLeads++;
        }

        for (const [key, labelName] of Object.entries(LABEL_MAPPINGS)) {
          if (labels.includes(labelName)) {
            // Cek apakah timestamp label ini ada di dalam range filter
            const labelTime = ts[labelName] ? ts[labelName] : new Date(s.last_updated).getTime();
            if (labelTime >= sDateMs && labelTime <= eDateMs) {
              statusCounts[key]++;
            }
          }
        }
      }

      const closingRate = totalLeads > 0
        ? Math.round((statusCounts.closing / totalLeads) * 100) : 0;

      // AI vs CS Manual reply counts
      const Op = require('sequelize').Op;
      const aiReplyCount = await ChatMessage.count({
        where: { ...msgWhere, is_from_me: true, sender_name: { [Op.not]: 'CS (dari HP)' } }
      });
      const csManualCount = await ChatMessage.count({
        where: { ...msgWhere, is_from_me: true, sender_name: 'CS (dari HP)' }
      });
      const totalOut = aiReplyCount + csManualCount;
      const aiHandlingRate = totalOut > 0 ? Math.round((aiReplyCount / totalOut) * 100) : 0;

      // Trend 30 hari - kontak baru + closing per hari
      const trendMap = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        trendMap[key] = { date: key, leads: 0, closing: 0 };
      }
      for (const s of allSummaries) {
        const key = new Date(s.createdAt).toISOString().slice(0, 10);
        if (trendMap[key]) {
          trendMap[key].leads++;
          let labels = [];
          try { labels = JSON.parse(s.wa_labels || '[]'); } catch(e){}
          let ts = {};
          try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(e){}
          
          if (labels.includes('Closing')) {
            const labelTime = ts['Closing'] ? ts['Closing'] : new Date(s.last_updated).getTime();
            const closeKey = new Date(labelTime).toISOString().slice(0, 10);
            if (trendMap[closeKey]) {
              trendMap[closeKey].closing++;
            }
          }
        }
      }
      const trend = Object.values(trendMap);

      // Per-store breakdown (hanya jika tidak difilter by store)
      let perStore = [];
      if (!store_wa_id) {
        const stores = await Store.findAll({ attributes: ['wa_id', 'name'] });
        for (const store of stores) {
          const storeSum = allSummaries.filter(s => s.store_wa_id === store.wa_id);
          
          let storeTotalLeads = 0;
          let storeClosing = 0;
          const sDateMs = startDate ? new Date(startDate).getTime() : 0;
          const eDateMs = endDate ? new Date(endDate).getTime() : Infinity;

          for (const s of storeSum) {
            const createdTime = new Date(s.createdAt).getTime();
            if (createdTime >= sDateMs && createdTime <= eDateMs) storeTotalLeads++;

            let labels = [];
            try { labels = JSON.parse(s.wa_labels || '[]'); } catch(e){}
            let ts = {};
            try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(e){}

            if (labels.includes('Closing')) {
              const labelTime = ts['Closing'] ? ts['Closing'] : new Date(s.last_updated).getTime();
              if (labelTime >= sDateMs && labelTime <= eDateMs) storeClosing++;
            }
          }

          const [storeAi, storeCs] = await Promise.all([
            ChatMessage.count({ where: { store_wa_id: store.wa_id, is_from_me: true, sender_name: { [Op.not]: 'CS (dari HP)' }, ...msgWhere } }),
            ChatMessage.count({ where: { store_wa_id: store.wa_id, is_from_me: true, sender_name: 'CS (dari HP)', ...msgWhere } })
          ]);
          perStore.push({
            wa_id: store.wa_id,
            name: store.name,
            totalLeads: storeTotalLeads,
            closing: storeClosing,
            closingRate: storeTotalLeads > 0 ? Math.round((storeClosing / storeTotalLeads) * 100) : 0,
            aiReplies: storeAi,
            csReplies: storeCs
          });
        }
      }

      // Top 10 kontak closing terbaru (sesuai filter)
      const sDateMs = startDate ? new Date(startDate).getTime() : 0;
      const eDateMs = endDate ? new Date(endDate).getTime() : Infinity;
      
      const topClosing = allSummaries
        .filter(s => {
          let labels = [];
          try { labels = JSON.parse(s.wa_labels || '[]'); } catch(e){}
          if (!labels.includes('Closing')) return false;
          let ts = {};
          try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(e){}
          const labelTime = ts['Closing'] ? ts['Closing'] : new Date(s.last_updated).getTime();
          return labelTime >= sDateMs && labelTime <= eDateMs;
        })
        .sort((a, b) => {
          let tsA = {}, tsB = {};
          try { tsA = JSON.parse(a.label_timestamps || '{}'); } catch(e){}
          try { tsB = JSON.parse(b.label_timestamps || '{}'); } catch(e){}
          const tA = tsA['Closing'] || new Date(a.last_updated).getTime();
          const tB = tsB['Closing'] || new Date(b.last_updated).getTime();
          return tB - tA;
        })
        .slice(0, 10)
        .map(s => ({
          store_wa_id: s.store_wa_id,
          contact_id: s.contact_id,
          contact_name: s.contact_name || 'Pelanggan',
          last_updated: s.last_updated,
          wa_labels: (() => { try { return JSON.parse(s.wa_labels || '[]'); } catch (_) { return []; } })()
        }));

      res.json({
        generatedAt: new Date().toISOString(),
        summary: { totalLeads, closingRate, aiHandlingRate, aiReplies: aiReplyCount, csReplies: csManualCount },
        statusBreakdown: statusCounts,
        trend,
        perStore,
        topClosing
      });

    } catch (e) {
      require('../utils/logger').error(\`[Analytics] Error: \${e.message}\`);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/analytics/leads
   * Menampilkan daftar kontak untuk filter status funnel
   */
  app.get('/api/analytics/leads', async (req, res) => {
    try {
      const { ChatSummary, Store } = require('../database/index');
      const { store_wa_id, label, startDate, endDate } = req.query;

      const summaryWhere = {};
      if (store_wa_id) summaryWhere.store_wa_id = store_wa_id;

      const allSummaries = await ChatSummary.findAll({ 
        where: summaryWhere,
        include: [{ model: Store, attributes: ['name'] }]
      });

      const sDateMs = startDate ? new Date(startDate).getTime() : 0;
      const eDateMs = endDate ? new Date(endDate).getTime() : Infinity;

      let LABEL_MAPPINGS = {
        closing: 'Closing',
        menunggu_transfer: 'Menunggu Transfer',
        menunggu_rekap: 'Menunggu Rekap',
        menunggu_alamat: 'Menunggu Alamat',
        negosiasi: 'Hot Lead',
        gali_kebutuhan: 'AI Lead Aktif',
        opening: 'AI Lead Baru'
      };

      const targetLabel = label === 'baru_masuk' ? 'baru_masuk' : (LABEL_MAPPINGS[label] || null);

      let leads = [];

      for (const s of allSummaries) {
        if (targetLabel === 'baru_masuk') {
          const createdTime = new Date(s.createdAt).getTime();
          if (createdTime >= sDateMs && createdTime <= eDateMs) {
            leads.push(s);
          }
        } else if (targetLabel) {
          let labels = [];
          try { labels = JSON.parse(s.wa_labels || '[]'); } catch(e){}
          if (labels.includes(targetLabel)) {
            let ts = {};
            try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(e){}
            const labelTime = ts[targetLabel] ? ts[targetLabel] : new Date(s.last_updated).getTime();
            if (labelTime >= sDateMs && labelTime <= eDateMs) {
              leads.push(s);
            }
          }
        }
      }

      leads.sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated));

      const result = leads.map(s => ({
        store_wa_id: s.store_wa_id,
        store_name: s.Store ? s.Store.name : 'Unknown Store',
        contact_id: s.contact_id,
        contact_name: s.contact_name || 'Pelanggan',
        contact_phone: s.contact_phone,
        last_updated: s.last_updated
      }));

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
`;

code = code.substring(0, overviewStart) + newOverviewCode + code.substring(nextApiStart + 5);

fs.writeFileSync(filePath, code);
console.log("Analytics APIs updated.");
