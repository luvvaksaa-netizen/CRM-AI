/**
 * @file dashboard_service.js
 * @description Web Dashboard & API Server (Express + Socket.io)
 * 
 * KEY FEATURES:
 *  - Session-based authentication (persistent via Sequelize / SQLite)
 *  - Route protection middleware with rate limiting
 *  - Production-ready session store (no MemoryStore warnings)
 *  - Real-time CRM dashboard via Socket.io
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const rateLimit = require('express-rate-limit');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const config = require('../config');
const { UPLOADS_DIR } = config;
const { Store, ChatMessage, sequelize } = require('../database/index');
const mediaService = require('./media_service');
const { normalizeWaChatId } = require('../utils/wa_id');
const { buildContactIdentity, formatPhoneNumber } = require('../utils/contact_identity');

// Kredensial Login (Selalu dari env di production)
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const ADMIN_USERS = parseAdminUsers();

let io;
const storeStatuses = {};
const app = express();
app.set('trust proxy', 1); // Wajib untuk Cloudflare / Nginx proxy
const server = http.createServer(app);

function isPlaceholderContactName(name) {
  const value = String(name || '').trim();
  return /^Kontak WA #\d+$/.test(value) || value === 'Kontak WA Privat' || value === 'Kontak WhatsApp';
}

function firstStableDisplayName(...values) {
  for (const value of values) {
    const name = String(value || '').trim();
    if (!name || name.includes('@')) continue;
    if (isPlaceholderContactName(name)) continue;
    return name;
  }
  return '';
}

function mergeStableContactIdentity(contactId, msg, identity, latestMsg) {
  const latest = latestMsg?.get ? latestMsg.get({ plain: true }) : (latestMsg || {});
  const stablePhone = msg.contact_phone || identity.phone || latest.contact_phone || null;
  const phoneDisplay = stablePhone ? formatPhoneNumber(stablePhone) : '';
  const stableDisplayName = firstStableDisplayName(
    msg.contact_display_name,
    identity.displayName,
    latest.contact_display_name,
    latest.sender_name,
    phoneDisplay
  ) || identity.displayName || latest.contact_display_name || latest.sender_name || phoneDisplay || 'Kontak WhatsApp';

  return {
    displayName: stableDisplayName,
    phone: stablePhone,
    lid: msg.contact_lid || identity.lid || latest.contact_lid || null,
    type: msg.contact_type || identity.type || latest.contact_type,
    source: msg.contact_source || identity.source || latest.contact_source
  };
}

function clipQuotedBody(value, maxLength = 700) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function parseAdminUsers() {
  if (!process.env.ADMIN_USERS_JSON) {
    return [{ user: ADMIN_USER, pass: ADMIN_PASS, role: 'admin' }];
  }

  try {
    const users = JSON.parse(process.env.ADMIN_USERS_JSON);
    if (!Array.isArray(users) || users.length === 0) throw new Error('must be a non-empty array');
    return users
      .filter(u => u?.user && u?.pass)
      .map(u => ({ user: String(u.user), pass: String(u.pass), role: u.role || 'operator' }));
  } catch (error) {
    logger.warn(`[Auth] ADMIN_USERS_JSON tidak valid (${error.message}). Fallback ke ADMIN_USER/ADMIN_PASS.`);
    return [{ user: ADMIN_USER, pass: ADMIN_PASS, role: 'admin' }];
  }
}

// ============================================================
// REQUEST LOGGING (Debug Only — bisa dimatikan di production)
// ============================================================
app.use((req, res, next) => {
  if (!req.url.includes('/assets') && !req.url.includes('.js') && !req.url.includes('.css') && !req.url.includes('/socket.io')) {
    logger.info(`[HTTP] ${req.method} ${req.url}`);
  }
  next();
});

// 1. SECURITY: Rate Limiter (Prevent Brute Force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Menit
  max: 12, // Maks 12 kali coba per 15 menit
  message: 'Terlalu banyak percobaan login. Silakan coba lagi nanti (15 menit).',
  standardHeaders: true,
  legacyHeaders: false,
});

const manualSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: 'Terlalu banyak request kirim pesan. Tunggu sebentar lalu coba lagi.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 2. LIVE SYSTEM LOGGING (Wow Factor)
let lastLogMsg = ""; 
const originalBotLogger = logger.bot;
logger.bot = (msg) => {
    if (io && msg !== lastLogMsg) {
        io.emit('sysLog', { type: 'BOT', msg, time: new Date().toLocaleTimeString() });
        lastLogMsg = msg;
    }
    originalBotLogger(msg);
};
const originalErrorLogger = logger.error;
logger.error = (msg) => {
    if (io && msg !== lastLogMsg) {
        io.emit('sysLog', { type: 'ERROR', msg, time: new Date().toLocaleTimeString() });
        lastLogMsg = msg;
    }
    originalErrorLogger(msg);
};

// ============================================================
// PRODUCTION-READY SESSION (Persistent via SQLite, bukan RAM)
// ============================================================
const sessionStore = new SequelizeStore({ db: sequelize });
sessionStore.sync(); // Buat tabel session jika belum ada

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'rekapoin-crm-xyz-secret-2025',
  store: sessionStore,         // ← Simpan di SQLite, bukan RAM
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,  // 24 Jam
    httpOnly: true,                // Lindungi dari XSS
    secure: process.env.NODE_ENV === 'production' // Auto-secure di production HTTPS
  }
}));

// ============================================================
// STATIC FILES (Publik)
// ============================================================
app.use('/login.html', express.static(path.join(process.cwd(), 'public', 'login.html')));
app.use('/assets', express.static(path.join(process.cwd(), 'public', 'assets')));

// ============================================================
// AUTH MIDDLEWARE
// ============================================================
const authenticate = (req, res, next) => {

  if (req.session && req.session.authenticated) return next();

  const isApiRequest = req.originalUrl.startsWith('/api');
  if (isApiRequest) {
    return res.status(401).json({ error: 'Unauthorized. Silakan login terlebih dahulu.' });
  }
  return res.redirect('/login.html');
};

const authorize = (...roles) => (req, res, next) => {
  const role = req.session?.role || 'viewer';
  if (role === 'admin' || roles.includes(role)) return next();
  return res.status(403).json({ success: false, message: 'Akses ditolak untuk role ini.' });
};

// ============================================================
// AUTH ROUTES (Login & Logout — tidak perlu autentikasi)
// ============================================================
app.post('/api/login', loginLimiter, (req, res) => {
  const { user, pass } = req.body;
  const account = ADMIN_USERS.find(u => u.user === user && u.pass === pass);
  if (account) {
    req.session.authenticated = true;
    req.session.user = account.user;
    req.session.role = account.role || 'operator';
    return res.json({ success: true, message: 'Login berhasil!' });
  }
  return res.status(401).json({ success: false, message: 'Username atau password salah.' });
});

app.get('/api/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

// Route utama — proteksi di sini
app.get('/', authenticate, (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Aset statis (termasuk index.html) — diproteksi setelah route / di atas
app.use(authenticate, express.static(path.join(process.cwd(), 'public')));

// Folder uploads dari DATA_DIR (persisten di Volume)
app.use('/uploads', authenticate, express.static(UPLOADS_DIR));


// ============================================================
// MULTER: File Upload Configuration
// ============================================================
const ALLOWED_TYPES = /jpeg|jpg|png|gif|webp|mp4|mov|avi|mkv|3gp/;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB hard ceiling

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Simpan ke UPLOADS_DIR (ada di dalam Volume, persisten)
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    ALLOWED_TYPES.test(ext) ? cb(null, true) : cb(new Error('Format file tidak didukung.'));
  }
});

// ============================================================
// INIT DASHBOARD
// ============================================================
function initDashboard(port = 3000) {
  io = new Server(server, { cors: { origin: '*' } });

  // Initialize Follow-Up Scheduler
  try {
    const { initFollowUpScheduler } = require('./followup_service');
    initFollowUpScheduler(io);
  } catch (err) {
    logger.error(`[Dashboard] Gagal inisialisasi Follow-Up Scheduler: ${err.message}`);
  }

  // 1. HEALTH MONITOR (Transmit to UI)
  setInterval(() => {
    try {
        const os = require('os');
        const free = os.freemem();
        const total = os.totalmem();
        const used = total - free;
        const load = os.loadavg()[0]; // 1-minute load average
        if (io) {
            io.emit('sysStats', {
                ram: { 
                    perc: Math.round((used / total) * 100), 
                    used: (used / 1024 / 1024 / 1024).toFixed(2), 
                    total: (total / 1024 / 1024 / 1024).toFixed(1) 
                },
                cpu: Math.round(load * 10), // Scale to 100% roughly
            });
        }
    } catch (e) {}
  }, 10000); // 10 Detik sekali



  // Proteksi semua /api/* (kecuali /api/login & /api/logout yang sudah di atas)
  app.use('/api', authenticate);

  app.get('/api/session', (req, res) => {
    res.json({ user: req.session.user, role: req.session.role || 'viewer' });
  });

  // ============================================================
  // AGENT APIs (Multi-Tenant AI Brains)
  // ============================================================

  // Ambil semua Agent
  app.get('/api/agents', async (req, res) => {
    try {
      const { BotAgent } = require('../database/index');
      const agents = await BotAgent.findAll({ order: [['id', 'ASC']] });
      res.json(agents);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Buat Agent Baru
  app.post('/api/agents', authorize('admin'), async (req, res) => {
    try {
      const { name, bot_name, system_prompt, product_knowledge, auto_labels } = req.body;
      const { BotAgent } = require('../database/index');
      const newAgent = await BotAgent.create({
        name: name || 'Agen Baru',
        bot_name: bot_name || 'CS Bot',
        system_prompt: system_prompt || 'Kamu adalah CS yang ramah.',
        product_knowledge: product_knowledge || '',
        auto_labels: auto_labels || ''
      });
      res.json({ success: true, agent: newAgent });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Update Agent
  app.put('/api/agents/:id', authorize('admin'), async (req, res) => {
    try {
      const { name, bot_name, system_prompt, product_knowledge, auto_labels } = req.body;
      const { BotAgent } = require('../database/index');
      const agent = await BotAgent.findByPk(req.params.id);
      if (!agent) return res.status(404).json({ success: false, message: 'Agent tidak ditemukan' });
      await agent.update({ name, bot_name, system_prompt, product_knowledge, auto_labels });
      res.json({ success: true, agent });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // DELETE: Hapus Agent & Cascade bersihkan Store dan Media (Hardening Phase 1)
  app.delete('/api/agents/:id', authorize('admin'), async (req, res) => {
    try {
      const agentId = req.params.id;
      const { BotAgent, MediaAsset } = require('../database/index');
      
      const agent = await BotAgent.findByPk(agentId);
      if (!agent) return res.status(404).json({ success: false, message: 'Agent tidak ditemukan' });

      // 1. Unbind semua Store yang menggunakan agen ini
      await Store.update({ agent_id: null }, { where: { agent_id: agentId } });

      // 2. Hapus semua media (DB + File Fisik)
      const mediaAssets = await MediaAsset.findAll({ where: { agent_id: agentId } });
      for (const asset of mediaAssets) {
        await mediaService.deleteMedia(asset.id, agentId); // Ini juga akan menghapus file fisiknya
      }

      // 3. Hapus Agen
      await agent.destroy();
      
      logger.success(`[Agent-${agentId}] Agen dan semua datanya berhasil dimusnahkan.`);
      res.json({ success: true, message: 'Agen berhasil dihapus.' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ============================================================
  // STORE APIs
  // ============================================================

  // GET: Semua Store + Status Real-time
  app.get('/api/stores', async (req, res) => {
    try {
      const stores = await Store.findAll({ order: [['createdAt', 'ASC']] });
      res.json(stores.map(s => ({ ...s.dataValues, status: storeStatuses[s.wa_id] || 'Offline' })));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST: Tambah Store Baru
  app.post('/api/stores', authorize('admin'), async (req, res) => {
    try {
      const { name, agent_id } = req.body;
      if (!name?.trim()) return res.status(400).json({ success: false, message: 'Nama toko wajib diisi!' });

      const wa_id = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 12)}-${Date.now().toString().slice(-4)}`;
      const newStore = await Store.create({
        wa_id, name: name.trim(),
        agent_id: agent_id ? parseInt(agent_id) : null,
        is_bot_active: true
      });

      // Launch WWebJS browser instance untuk nomor WA baru
      const whatsappService = require('../whatsapp_service');
      const client = whatsappService.createWhatsAppClient(wa_id);
      whatsappService.setupEventListeners(client, wa_id);
      client.initialize();

      res.json({ success: true, store: newStore });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // TAHAP 4: REKAP PEMBAHASAN API
  app.get('/api/summaries', async (req, res) => {
    try {
      const { ChatSummary, Store } = require('../database/index');
      const { storeId, status } = req.query;
      const where = {};
      if (storeId) where.store_wa_id = storeId;

      const summaries = await ChatSummary.findAll({
        where,
        order: [['last_updated', 'DESC']],
        include: [{ model: Store, attributes: ['name', 'wa_id'] }]
      });

      // Filter by status keyword if requested (e.g. ?status=closing)
      const filtered = status
        ? summaries.filter(s => (s.summary || '').toLowerCase().includes(`status: ${status.toLowerCase()}`))
        : summaries;

      res.json(filtered);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET: Rekap hanya yang STATUS closing / menunggu transfer (untuk halaman Closing)
  app.get('/api/summaries/closing', async (req, res) => {
    try {
      const { ChatSummary } = require('../database/index');
      const { storeId } = req.query;
      const where = {};
      if (storeId) where.store_wa_id = storeId;

      const allSummaries = await ChatSummary.findAll({
        where,
        order: [['last_updated', 'DESC']]
      });

      // Hybrid detection: wa_labels (prioritas) → regex pada teks summary (fallback)
      const CLOSING_LABEL_NAMES = ['Closing', 'Menunggu Transfer'];
      const CLOSING_STATUS_RE   = /status:\s*(closing|selesai|menunggu\s*transfer)/i;

      const closingList = allSummaries.filter(s => {
        try {
          const labels = JSON.parse(s.wa_labels || '[]');
          if (labels.some(l => CLOSING_LABEL_NAMES.includes(l))) return true;
        } catch(_) {}
        return CLOSING_STATUS_RE.test(s.summary || '');
      });

      res.json(closingList);
    } catch (e) {

      res.status(500).json({ error: e.message });
    }
  });

  // GET: Statistik ringkas — jumlah closing hari ini
  app.get('/api/summaries/stats', async (req, res) => {
    try {
      const { ChatSummary } = require('../database/index');
      const { storeId } = req.query;
      const where = {};
      if (storeId) where.store_wa_id = storeId;

      const allSummaries = await ChatSummary.findAll({ where });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let closing = 0, transferPending = 0, selesai = 0, total = allSummaries.length;
      for (const s of allSummaries) {
        const txt = (s.summary || '').toLowerCase();
        if (txt.includes('status: closing'))           closing++;
        if (txt.includes('status: menunggu transfer')) transferPending++;
        if (txt.includes('status: selesai'))           selesai++;
      }

      res.json({ total, closing, transferPending, selesai });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // ANALYTICS API — Real-time Lead Intelligence Dashboard
  // ============================================================

  /**
   * GET /api/analytics/overview
   * Aggregasi: AI vs CS Manual, breakdown status, trend 30 hari, per-store.
   * Query params: ?store_wa_id=xxx (opsional, default = semua store)
   */
  app.get('/api/analytics/overview', async (req, res) => {
    try {
      const { ChatSummary, ChatMessage, Store } = require('../database/index');
      const { store_wa_id, startDate, endDate } = req.query;
      const Op = require('sequelize').Op;

      const summaryWhere = {};
      const msgWhere = {};
      if (store_wa_id) {
        summaryWhere.store_wa_id = store_wa_id;
        msgWhere.store_wa_id    = store_wa_id;
      }
      if (startDate && endDate) {
        msgWhere.timestamp = { [Op.between]: [new Date(startDate), new Date(endDate)] };
      }

      const allSummaries = await ChatSummary.findAll({ where: summaryWhere });

      // ── HYBRID LABEL DETECTION ──────────────────────────────────────
      // Prioritas: wa_labels column → fallback regex pada summary text
      // Ini memastikan data lama yang belum punya wa_labels tetap terhitung
      const STATUS_REGEX_FALLBACK = {
        closing:           /status:\s*(closing|selesai)/i,
        menunggu_transfer: /status:\s*menunggu\s*transfer/i,
        menunggu_rekap:    /status:\s*menunggu\s*rekap/i,
        menunggu_alamat:   /status:\s*menunggu\s*alamat/i,
        negosiasi:         /status:\s*negosiasi/i,
        gali_kebutuhan:    /status:\s*gali\s*kebutuhan/i,
        opening:           /status:\s*opening/i,
      };
      const LABEL_NAMES = {
        closing: 'Closing', menunggu_transfer: 'Menunggu Transfer',
        menunggu_rekap: 'Menunggu Rekap', menunggu_alamat: 'Menunggu Alamat',
        negosiasi: 'Hot Lead', gali_kebutuhan: 'AI Lead Aktif', opening: 'AI Lead Baru'
      };

      function detectStatus(record) {
        let labels = [];
        try { labels = JSON.parse(record.wa_labels || '[]'); } catch(_){}
        if (labels.length > 0) {
          for (const [key, labelName] of Object.entries(LABEL_NAMES)) {
            if (labels.includes(labelName)) return key;
          }
        }
        // Fallback: regex pada summary text (data lama)
        const txt = record.summary || '';
        for (const [key, re] of Object.entries(STATUS_REGEX_FALLBACK)) {
          if (re.test(txt)) return key;
        }
        return null;
      }

      const sDateMs = startDate ? new Date(startDate).getTime() : 0;
      const eDateMs = endDate   ? new Date(endDate).getTime()   : Infinity;

      const statusCounts = Object.fromEntries(Object.keys(LABEL_NAMES).map(k => [k, 0]));
      let totalLeads = 0;

      for (const s of allSummaries) {
        const createdTime = new Date(s.createdAt).getTime();
        if (createdTime >= sDateMs && createdTime <= eDateMs) totalLeads++;

        const status = detectStatus(s);
        if (status) {
          // Tentukan waktu label: dari label_timestamps → last_updated → createdAt
          let ts = {};
          try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}
          const labelName = LABEL_NAMES[status];
          const labelTime = ts[labelName] || new Date(s.last_updated || s.createdAt).getTime();
          if (labelTime >= sDateMs && labelTime <= eDateMs) {
            statusCounts[status]++;
          }
        }
      }

      const closingRate = totalLeads > 0
        ? Math.round((statusCounts.closing / totalLeads) * 100) : 0;

      // AI vs CS Manual reply counts
      const aiReplyCount = await ChatMessage.count({
        where: { ...msgWhere, is_from_me: true, sender_name: { [Op.not]: 'CS (dari HP)' } }
      });
      const csManualCount = await ChatMessage.count({
        where: { ...msgWhere, is_from_me: true, sender_name: 'CS (dari HP)' }
      });
      const totalOut = aiReplyCount + csManualCount;
      const aiHandlingRate = totalOut > 0 ? Math.round((aiReplyCount / totalOut) * 100) : 0;

      // Trend 30 hari
      const trendMap = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        trendMap[key] = { date: key, leads: 0, closing: 0 };
      }
      for (const s of allSummaries) {
        const dayKey = new Date(s.createdAt).toISOString().slice(0, 10);
        if (trendMap[dayKey]) {
          trendMap[dayKey].leads++;
          const status = detectStatus(s);
          if (status === 'closing') {
            let ts = {};
            try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}
            const labelTime = ts['Closing'] || new Date(s.last_updated || s.createdAt).getTime();
            const closeKey = new Date(labelTime).toISOString().slice(0, 10);
            if (trendMap[closeKey]) trendMap[closeKey].closing++;
          }
        }
      }
      const trend = Object.values(trendMap);

      // Per-store breakdown
      let perStore = [];
      const storesToProcess = store_wa_id 
        ? await Store.findAll({ where: { wa_id: store_wa_id }, attributes: ['wa_id', 'name'] })
        : await Store.findAll({ attributes: ['wa_id', 'name'] });

      for (const store of storesToProcess) {
        // If a specific store is filtered, allSummaries already contains only that store's summaries
        const storeSum = store_wa_id ? allSummaries : allSummaries.filter(s => s.store_wa_id === store.wa_id);
        let storeTotalLeads = 0, storeClosing = 0;
        for (const s of storeSum) {
          if (new Date(s.createdAt).getTime() >= sDateMs && new Date(s.createdAt).getTime() <= eDateMs) storeTotalLeads++;
          const status = detectStatus(s);
          if (status === 'closing') {
            let ts = {};
            try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}
            const lt = ts['Closing'] || new Date(s.last_updated || s.createdAt).getTime();
            if (lt >= sDateMs && lt <= eDateMs) storeClosing++;
          }
        }
        
        // Count messages for this store within the date range
        const storeAi = await ChatMessage.count({ 
            where: { store_wa_id: store.wa_id, is_from_me: true, sender_name: { [Op.not]: 'CS (dari HP)' }, ...msgWhere } 
        });
        const storeCs = await ChatMessage.count({ 
            where: { store_wa_id: store.wa_id, is_from_me: true, sender_name: 'CS (dari HP)', ...msgWhere } 
        });

        perStore.push({
          wa_id: store.wa_id, name: store.name,
          totalLeads: storeTotalLeads, closing: storeClosing,
          closingRate: storeTotalLeads > 0 ? Math.round((storeClosing / storeTotalLeads) * 100) : 0,
          aiReplies: storeAi, csReplies: storeCs
        });
      }

      // Top 10 closing terbaru
      const topClosing = allSummaries
        .filter(s => {
          const status = detectStatus(s);
          if (status !== 'closing') return false;
          let ts = {};
          try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}
          const lt = ts['Closing'] || new Date(s.last_updated || s.createdAt).getTime();
          return lt >= sDateMs && lt <= eDateMs;
        })
        .sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated))
        .slice(0, 10)
        .map(s => ({
          store_wa_id: s.store_wa_id, contact_id: s.contact_id,
          contact_name: s.contact_name || 'Pelanggan', last_updated: s.last_updated,
          wa_labels: (() => { try { return JSON.parse(s.wa_labels || '[]'); } catch(_) { return []; } })()
        }));

      res.json({
        generatedAt: new Date().toISOString(),
        summary: { totalLeads, closingRate, aiHandlingRate, aiReplies: aiReplyCount, csReplies: csManualCount },
        statusBreakdown: statusCounts, trend, perStore, topClosing
      });

    } catch (e) {
      logger.error(`[Analytics] Error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/analytics/leads
   * Menampilkan daftar kontak berdasarkan status label (drill-down dari funnel)
   */
  app.get('/api/analytics/leads', async (req, res) => {
    try {
      const { ChatSummary, Store } = require('../database/index');
      const { store_wa_id, label, startDate, endDate } = req.query;

      const summaryWhere = {};
      if (store_wa_id) summaryWhere.store_wa_id = store_wa_id;

      const allSummaries = await ChatSummary.findAll({ where: summaryWhere });

      // Ambil store names untuk mapping
      const stores = await Store.findAll({ attributes: ['wa_id', 'name'] });
      const storeMap = {};
      for (const st of stores) storeMap[st.wa_id] = st.name;

      const sDateMs = startDate ? new Date(startDate).getTime() : 0;
      const eDateMs = endDate   ? new Date(endDate).getTime()   : Infinity;

      const LABEL_NAMES = {
        closing: 'Closing', menunggu_transfer: 'Menunggu Transfer',
        menunggu_rekap: 'Menunggu Rekap', menunggu_alamat: 'Menunggu Alamat',
        negosiasi: 'Hot Lead', gali_kebutuhan: 'AI Lead Aktif', opening: 'AI Lead Baru'
      };
      const STATUS_REGEX = {
        closing:           /status:\s*(closing|selesai)/i,
        menunggu_transfer: /status:\s*menunggu\s*transfer/i,
        menunggu_rekap:    /status:\s*menunggu\s*rekap/i,
        menunggu_alamat:   /status:\s*menunggu\s*alamat/i,
        negosiasi:         /status:\s*negosiasi/i,
        gali_kebutuhan:    /status:\s*gali\s*kebutuhan/i,
        opening:           /status:\s*opening/i,
      };

      let leads = [];

      for (const s of allSummaries) {
        if (label === 'baru_masuk') {
          const ct = new Date(s.createdAt).getTime();
          if (ct >= sDateMs && ct <= eDateMs) leads.push(s);
          continue;
        }

        // Hybrid detection
        let matchedLabels = [];
        try { matchedLabels = JSON.parse(s.wa_labels || '[]'); } catch(_){}
        const targetLabelName = LABEL_NAMES[label];
        if (!targetLabelName) continue;

        let hasLabel = matchedLabels.includes(targetLabelName);
        // Fallback regex
        if (!hasLabel && STATUS_REGEX[label]) {
          hasLabel = STATUS_REGEX[label].test(s.summary || '');
        }
        if (!hasLabel) continue;

        let ts = {};
        try { ts = JSON.parse(s.label_timestamps || '{}'); } catch(_){}
        const labelTime = ts[targetLabelName] || new Date(s.last_updated || s.createdAt).getTime();
        if (labelTime >= sDateMs && labelTime <= eDateMs) {
          leads.push(s);
        }
      }

      leads.sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated));

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
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/analytics/followups
   * Follow-up stats semua store, dengan filter opsional per ?store_wa_id=xxx
   */
  app.get('/api/analytics/followups', async (req, res) => {
    try {
      const { FollowUp, Store } = require('../database/index');
      const { store_wa_id } = req.query;
      const stores = await Store.findAll({ attributes: ['wa_id', 'name'] });
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
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // FOLLOW-UP APIs
  // ============================================================

  // GET: Get follow-up stats (HARUS SEBELUM /:storeId agar 'stats' tidak dianggap storeId)
  app.get('/api/followups/stats/:storeId', async (req, res) => {
    try {
      const { getFollowUpStats } = require('./followup_service');
      const stats = await getFollowUpStats(req.params.storeId);
      res.json(stats);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET: Get all follow-ups for a specific store
  app.get('/api/followups/:storeId', async (req, res) => {
    try {
      const { getFollowUps } = require('./followup_service');
      const { status, limit } = req.query;
      const followUps = await getFollowUps(req.params.storeId, {
        status: status || undefined,
        limit: limit ? parseInt(limit, 10) : 100
      });
      res.json(followUps);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST: Cancel follow-up by ID
  app.post('/api/followups/cancel/:id', authorize('operator'), async (req, res) => {
    try {
      const { cancelFollowUpById } = require('./followup_service');
      const success = await cancelFollowUpById(req.params.id);
      if (success) {
        res.json({ success: true, message: 'Follow-up berhasil dibatalkan.' });
      } else {
        res.status(400).json({ success: false, message: 'Follow-up tidak ditemukan atau sudah tidak pending.' });
      }
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // DELETE: Hapus Store & Bersihkan Semua Data (Clean Slate)
  app.delete('/api/stores/:id', authorize('admin'), async (req, res) => {
    try {
      const wa_id = req.params.id;
      const whatsappService = require('../whatsapp_service');
      const { ChatMessage, ChatSummary } = require('../database/index');

      // 1. Matikan dan putuskan sesi fisik WA secara tuntas
      await whatsappService.logoutClient(wa_id);

      // 2. Hapus seluruh riwayat chat agen ini agar tidak mencampur data dengan nomor baru
      await ChatMessage.destroy({ where: { store_wa_id: wa_id } });
      await ChatSummary.destroy({ where: { store_wa_id: wa_id } }); // Phase 1: Clean summary too

      // 3. Hapus profil Toko dari Database
      await Store.destroy({ where: { wa_id } });

      logger.success(`[${wa_id}] Toko dan data histori telah dihapus total (Wiped).`);
      res.json({ success: true, message: 'Toko dan seluruh data berhasil dimusnahkan.' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // POST: Logout Sesi (Putuskan WA tanpa hapus data)
  app.post('/api/stores/:id/logout', authorize('admin'), async (req, res) => {
    try {
      const wa_id = req.params.id;
      const whatsappService = require('../whatsapp_service');
      await whatsappService.logoutClient(wa_id);
      
      res.json({ success: true, message: 'Sesi WA berhasil diputuskan.' });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ============================================================
  // SYSTEM & BACKUP APIs (Professional Grade)
  // ============================================================
  
  // GET: List Backups
  app.get('/api/system/backups', async (req, res) => {
    try {
      const BACKUP_DIR = path.join(process.cwd(), 'backups');
      if (!fs.existsSync(BACKUP_DIR)) return res.json([]);
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.sqlite'))
        .map(f => {
          const stat = fs.statSync(path.join(BACKUP_DIR, f));
          return { name: f, size: Math.round(stat.size / 1024), time: stat.mtime };
        })
        .sort((a,b) => b.time - a.time);
      res.json(files);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET: Download Backup
  app.get('/api/system/backups/:name', authorize('admin'), (req, res) => {
    try {
      const filePath = path.join(process.cwd(), 'backups', req.params.name);
      if (!fs.existsSync(filePath)) return res.status(404).send('Not Found');
      res.download(filePath);
    } catch (e) { res.status(500).send(e.message); }
  });

  // GET: Download Application Log (Production Debugging)
  app.get('/api/system/logs', authorize('admin'), (req, res) => {
    try {
      const logPath = path.join(process.cwd(), 'logs', 'app.log');
      if (!fs.existsSync(logPath)) return res.status(404).send('File log tidak ditemukan.');
      res.download(logPath);
    } catch (e) { res.status(500).send(e.message); }
  });

  app.get('/api/system/wa-js', async (req, res) => {
    try {
      const whatsappService = require('../whatsapp_service');
      const clients = whatsappService.getClients();
      const stores = [];
      for (const [storeId, client] of clients) {
        stores.push({ storeId, ...(await whatsappService.getClientWajsStatus(client)) });
      }
      let packageInstalled = false;
      try {
        require.resolve('@wppconnect/wa-js');
        packageInstalled = true;
      } catch (_) {}
      res.json({
        packageInstalled,
        stores
      });
    } catch (e) {
      res.json({ packageInstalled: false, stores: [], message: e.message });
    }
  });
  // ============================================================
  // SETTINGS APIs
  // ============================================================

  // GET: Settings Store Spesifik
  app.get('/api/settings/:storeId', async (req, res) => {
    try {
      const s = await Store.findOne({ where: { wa_id: req.params.storeId } });
      if (!s) return res.status(404).json({ error: 'Store tidak ditemukan.' });
      res.json({ ...s.dataValues, status: storeStatuses[req.params.storeId] || 'Offline' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST: Update Settings Store (Device Binding)
  app.post('/api/settings/:storeId', authorize('admin'), async (req, res) => {
    try {
      const { name, is_bot_active, agent_id } = req.body;
      const store = await Store.findOne({ where: { wa_id: req.params.storeId } });
      if (!store) return res.status(404).json({ success: false, message: 'Store tidak ditemukan.' });

      // Simpan status bot SEBELUM update untuk deteksi transisi OFF→ON
      const wasBotInactive = store.is_bot_active === false;
      
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (is_bot_active !== undefined) updateData.is_bot_active = is_bot_active;
      if (agent_id !== undefined) updateData.agent_id = agent_id ? parseInt(agent_id) : null;

      await store.update(updateData);
      await store.reload(); // Pastikan data terbaru dari DB

      logger.info(`[Settings] ${req.params.storeId} updated: ${JSON.stringify(updateData)}`);
      res.json({ success: true, store: store.dataValues });
      if (io) io.emit('storeUpdated', { storeId: req.params.storeId });

      // ── SMART BOT RE-ACTIVATION ──────────────────────────────────────────
      // Ketika bot di-toggle dari OFF → ON: scan konteks percakapan background.
      // Tidak perlu await — response sudah dikirim, ini berjalan di background.
      const botJustActivated = wasBotInactive && is_bot_active === true;
      if (botJustActivated) {
        logger.info(`[Settings] Bot [${req.params.storeId}] dinyalakan — memulai smart re-activation scan...`);
        try {
          const { onBotActivated } = require('../services/bot_activation_service');
          onBotActivated(req.params.storeId).catch(e => {
            logger.warn(`[BotActivation] Background scan error: ${e.message}`);
          });
        } catch (activationErr) {
          logger.warn(`[BotActivation] Gagal memulai scan: ${activationErr.message}`);
        }
      }

    } catch (error) {
      logger.error(`[Settings] Gagal update ${req.params.storeId}: ${error.message}`);
      res.status(500).json({ success: false, message: error.message });
    }
  });


  // ============================================================
  // CHAT APIs
  // ============================================================

  // GET: Chat History (Per Store + Filter per Contact)
  app.get('/api/chat/:storeId', async (req, res) => {
    try {
      const { contactId, before, paginated } = req.query;
      // Perbaikan: Naikkan max limit menjadi 2000 saat memuat riwayat global agar tidak ada chat/kontak yang hilang di sidebar
      const maxLimit = contactId ? 200 : 2000;
      const defaultLimit = contactId ? 50 : 2000;
      const limit = Math.min(Math.max(parseInt(req.query.limit || defaultLimit, 10) || 50, 1), maxLimit);
      const where = { store_wa_id: req.params.storeId };
      
      // Jika ada contactId, ambil history spesifik dengan limit lebih besar
      if (contactId) {
          where.contact_id = contactId;
      }
      if (before) {
        const beforeDate = new Date(before);
        if (!Number.isNaN(beforeDate.getTime())) {
          where.timestamp = { [Op.lt]: beforeDate };
        }
      }

      let history = await ChatMessage.findAll({
        where,
        limit: limit + 1,
        order: [['timestamp', 'DESC']]
      });
      const hasMore = history.length > limit;
      if (hasMore) history = history.slice(0, limit);
      const items = history.reverse();

      if (paginated === 'true') {
        return res.json({
          messages: items,
          pagination: {
            limit,
            hasMore,
            nextBefore: items[0]?.timestamp || null
          }
        });
      }

      res.json(items);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST: Mark Chat as Read
  app.post('/api/chat/:storeId/:contactId/read', async (req, res) => {
    try {
      const { storeId, contactId } = req.params;
      
      const [updated] = await ChatMessage.update(
        { is_read: true },
        { where: { store_wa_id: storeId, contact_id: contactId, is_read: false, is_from_me: false } }
      );

      if (updated > 0 && io) {
        io.emit('chatRead', { storeId, contactId });
      }

      res.json({ success: true, updated });
    } catch (e) {
      logger.error(`[Read] Gagal mark as read ${req.params.contactId}: ${e.message}`);
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // DELETE: Hapus Semua Riwayat Chat Kontak (untuk testing / reset)
  app.delete('/api/chat/:storeId/:contactId', authorize('admin'), async (req, res) => {
    try {
      const { storeId, contactId } = req.params;
      const decodedContactId = decodeURIComponent(contactId);

      const { ChatSummary } = require('../database/index');

      const deletedMsgs = await ChatMessage.destroy({
        where: { store_wa_id: storeId, contact_id: decodedContactId }
      });
      const deletedSummary = await ChatSummary.destroy({
        where: { store_wa_id: storeId, contact_id: decodedContactId }
      });

      // Hapus dari PausedContact juga agar bot aktif kembali
      const { PausedContact } = require('../database/index');
      await PausedContact.destroy({ where: { store_wa_id: storeId, contact_id: decodedContactId } }).catch(() => {});

      // Beritahu frontend via Socket.IO agar daftar kontak terupdate
      if (io) io.emit('chatCleared', { storeId, contactId: decodedContactId });

      logger.info(`[${storeId}] 🗑️ Riwayat chat [${decodedContactId}] dihapus: ${deletedMsgs} pesan, ${deletedSummary} summary.`);
      res.json({ success: true, deletedMsgs, deletedSummary });
    } catch (e) {
      logger.error(`[ClearChat] Error: ${e.message}`);
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // POST: Kirim Pesan Manual
  app.post('/api/send', manualSendLimiter, authorize('operator'), async (req, res) => {
    try {
      const { storeId, to, body, quotedMessageId, quotedBody, quotedFromMe, quotedSenderName } = req.body;
      if (!storeId || !to || !body) return res.status(400).json({ success: false, message: 'storeId, to, body wajib diisi.' });
      const target = normalizeWaChatId(to);
      if (!target.ok) return res.status(400).json({ success: false, message: target.error });
      if (String(body).trim().length > 4000) return res.status(400).json({ success: false, message: 'Pesan terlalu panjang (maks 4000 karakter).' });

      const whatsappService = require('../whatsapp_service');
      await whatsappService.sendManualMessage(storeId, target.value, String(body).trim(), {
        quotedMessageId,
        quotedBody,
        quotedFromMe,
        quotedSenderName
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // POST: Kirim Media Manual
  app.post('/api/send-media', manualSendLimiter, authorize('operator'), async (req, res) => {
    try {
      const { storeId, to, mediaId } = req.body;
      if (!storeId || !to || !mediaId) return res.status(400).json({ success: false, message: 'Data tidak lengkap.' });
      const target = normalizeWaChatId(to);
      if (!target.ok) return res.status(400).json({ success: false, message: target.error });
      
      const { MediaAsset, Store } = require('../database/index');
      const store = await Store.findOne({ where: { wa_id: storeId } });
      if (!store) return res.status(404).json({ success: false, message: 'Store tidak ditemukan.' });

      const asset = await MediaAsset.findOne({ where: { id: mediaId, agent_id: store.agent_id } });
      if (!asset) return res.status(404).json({ success: false, message: 'Media tidak ditemukan untuk agen ini.' });

      const whatsappService = require('../whatsapp_service');
      await whatsappService.sendManualMedia(storeId, target.value, asset);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ============================================================
  // MEDIA APIs — Per-Store + Vision AI + Whisper + Purpose Control
  // ============================================================

  // WA-JS: Minta nomor asli untuk kontak LID (WhatsApp private ID)
  app.post('/api/stores/:storeId/contacts/:contactId/request-phone', manualSendLimiter, authorize('operator', 'viewer'), async (req, res) => {
    try {
      const whatsappService = require('../whatsapp_service');
      const { storeId, contactId } = req.params;
      let resolved = null;
      let resolveError = null;

      try {
        resolved = await whatsappService.resolveContactPhone(storeId, contactId);
      } catch (error) {
        resolveError = error;
      }

      if (resolved?.phone) {
        const identity = await updateContactPhoneIdentity(storeId, contactId, resolved);
        return res.json({ success: true, resolved: true, requested: false, phone: resolved.phone, identity });
      }

      const result = await whatsappService.requestPhoneNumber(storeId, contactId);
      res.json({
        success: true,
        resolved: false,
        requested: true,
        result,
        message: resolveError ? `Nomor belum ada di cache lokal (${resolveError.message}). Permintaan nomor asli sudah dikirim.` : 'Permintaan nomor asli sudah dikirim.'
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // WA-JS: Label bisnis WhatsApp (WA Business)
  app.get('/api/stores/:storeId/labels', authorize('operator'), async (req, res) => {
    try {
      const whatsappService = require('../whatsapp_service');
      const labels = await whatsappService.getLabels(req.params.storeId);
      res.json({ success: true, labels });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/stores/:storeId/labels', authorize('operator'), async (req, res) => {
    try {
      const { name, color } = req.body;
      const whatsappService = require('../whatsapp_service');
      const label = await whatsappService.createLabel(req.params.storeId, name, color);
      res.json({ success: true, label });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get('/api/stores/:storeId/labels/palette', authorize('operator'), async (req, res) => {
    try {
      const whatsappService = require('../whatsapp_service');
      const colors = await whatsappService.getLabelColorPalette(req.params.storeId);
      res.json({ success: true, colors });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.put('/api/stores/:storeId/labels/:labelId', authorize('operator'), async (req, res) => {
    try {
      const { name, color } = req.body;
      const whatsappService = require('../whatsapp_service');
      const label = await whatsappService.editLabel(req.params.storeId, req.params.labelId, { name, color });
      res.json({ success: true, label });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.delete('/api/stores/:storeId/labels/:labelId', authorize('operator'), async (req, res) => {
    try {
      const whatsappService = require('../whatsapp_service');
      const result = await whatsappService.deleteLabel(req.params.storeId, req.params.labelId);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/stores/:storeId/contacts/:contactId/labels', manualSendLimiter, authorize('operator'), async (req, res) => {
    try {
      const { labelId, labelIds, type, operations } = req.body;
      const labelOps = operations || (Array.isArray(labelIds)
        ? labelIds.map(id => ({ labelId: id, type: type || 'add' }))
        : [{ labelId: labelId || labelIds, type: type || 'add' }]);

      const whatsappService = require('../whatsapp_service');
      const result = await whatsappService.addOrRemoveLabels(req.params.storeId, req.params.contactId, labelOps);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // WA-JS: Reaksi dan forward pesan tersimpan
  app.post('/api/stores/:storeId/messages/reaction', manualSendLimiter, authorize('operator'), async (req, res) => {
    try {
      const { messageId, emoji } = req.body;
      const whatsappService = require('../whatsapp_service');
      const result = await whatsappService.sendReaction(req.params.storeId, messageId, emoji);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/stores/:storeId/messages/forward', manualSendLimiter, authorize('operator'), async (req, res) => {
    try {
      const { to, messageId, messageIds, displayCaptionText, multicast } = req.body;
      const ids = messageIds || messageId;
      const whatsappService = require('../whatsapp_service');
      const result = await whatsappService.forwardMessages(req.params.storeId, to, ids, {
        displayCaptionText: Boolean(displayCaptionText),
        multicast: Boolean(multicast)
      });
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // GET: Semua media milik agen tertentu
  app.get('/api/media/:agentId', async (req, res) => {
    try {
      const assets = await mediaService.getMediaByAgent(req.params.agentId);
      res.json(assets);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST: Upload media baru (semua tipe) + analisis AI otomatis di background
  app.post('/api/media/:agentId', authorize('operator'), upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'File tidak ditemukan.' });

    const tempPath = req.file.path;
    try {
      const { label, description, purpose } = req.body;
      const mimeType  = req.file.mimetype;
      const fileType  = mimeType.startsWith('image') ? 'image' : 'video';
      const fileSizeKb = Math.round(req.file.size / 1024);
      const agentId   = req.params.agentId;

      // Validasi ukuran
      const maxSizeKb = fileType === 'image' ? 10240 : 102400; // Image 10MB, Video 100MB
      if (fileSizeKb > maxSizeKb) {
        fs.unlinkSync(tempPath);
        return res.status(400).json({ success: false, message: `File terlalu besar. Maks ${fileType === 'image' ? '10MB' : '100MB'}.` });
      }

      // Validasi agen
      const { BotAgent } = require('../database/index');
      const agent = await BotAgent.findByPk(agentId);
      if (!agent) {
        fs.unlinkSync(tempPath);
        return res.status(404).json({ success: false, message: 'Agent tidak ditemukan.' });
      }

      // Validasi purpose
      const validPurposes = ['both', 'knowledge_only', 'send_only'];
      const mediaPurpose = validPurposes.includes(purpose) ? purpose : 'both';

      const assetData = {
        agent_id:      agentId,
        filename:      req.file.filename,
        original_name: req.file.originalname,
        type:          fileType,
        label:         label?.trim() || req.file.originalname,
        description:   description?.trim() || '',
        purpose:       mediaPurpose,
        filePath:      tempPath
      };

      // Semua upload bersifat non-blocking: daftarkan dulu, analisis di background
      const analysisMsg = fileType === 'image'
        ? 'Foto diupload! AI Vision sedang menganalisis isi gambar...'
        : 'Video diupload! AI sedang mentranskripsi narasi & menganalisis visual...';

      mediaService.registerMedia(assetData, (asset) => {
        // Callback saat analisis selesai
        if (io) {
          io.emit('mediaUpdated',      { agentId });
          io.emit('mediaAnalysisReady', { agentId, assetId: asset.id });
        }
      }).then(() => {
        // Emit update awal setelah record dibuat (sebelum analisis selesai)
        if (io) io.emit('mediaUpdated', { agentId });
      }).catch(err => logger.error(`Upload register error: ${err.message}`));

      res.json({ success: true, message: analysisMsg, purpose: mediaPurpose });

    } catch (error) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      logger.error(`Upload error: ${error.message}`);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // PUT: Update seluruh detail informasi media (Label, Description, Purpose, Tags, AI Override) tanpa re-upload
  app.put('/api/media/:agentId/:id', authorize('operator'), async (req, res) => {
    try {
      const { purpose, label, description, ai_analysis, trigger_words } = req.body;
      const validPurposes = ['both', 'knowledge_only', 'send_only'];
      if (purpose && !validPurposes.includes(purpose)) return res.status(400).json({ success: false, message: 'Purpose tidak valid.' });

      const asset = await mediaService.updateMediaDetails(parseInt(req.params.id), req.params.agentId, {
          purpose, label, description, ai_analysis, trigger_words
      });
      if (io) io.emit('mediaUpdated', { agentId: req.params.agentId });
      res.json({ success: true, asset: asset.dataValues });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  });

  // DELETE: Hapus media dengan verifikasi kepemilikan agen
  app.delete('/api/media/:agentId/:id', authorize('operator'), async (req, res) => {
    try {
      await mediaService.deleteMedia(parseInt(req.params.id), req.params.agentId);
      if (io) io.emit('mediaUpdated', { agentId: req.params.agentId });
      res.json({ success: true });
    } catch (error) {
      logger.error(`Delete media error: ${error.message}`);
      res.status(400).json({ success: false, message: error.message });
    }
  });

  // ============================================================
  // HUMAN OVERRIDE (Pause/Resume AI per Contact)
  // ============================================================
  app.get('/api/stores/:storeId/contacts/:contactId/pause', async (req, res) => {
    try {
      const { PausedContact } = require('../database/index');
      const record = await PausedContact.findOne({
        where: { store_wa_id: req.params.storeId, contact_id: req.params.contactId }
      });
      res.json({ isPaused: !!record });
    } catch (e) {
      res.json({ isPaused: false });
    }
  });

  app.post('/api/stores/:storeId/contacts/:contactId/pause', authorize('operator'), async (req, res) => {
    try {
      const { isPaused } = req.body;
      const { storeId, contactId } = req.params;
      const { pauseBotForContact, resumeBotForContact } = require('../events/message_handler');

      if (isPaused) {
        await pauseBotForContact(storeId, contactId);
      } else {
        await resumeBotForContact(storeId, contactId);
      }
      res.json({ success: true, isPaused });
    } catch (e) {
      logger.error(`[Pause API] ${e.message}`);
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ============================================================
  // SOCKET.IO
  // ============================================================
  io.on('connection', (socket) => {
    socket.emit('allStatuses', storeStatuses);
  });

  server.listen(port, () => {
    logger.success(`Omni-Dashboard: http://localhost:${port}`);
  });
}

// ============================================================
// EXPORTED FUNCTIONS (used by whatsapp_service & message_handler)
// ============================================================

function updateWAStatus(storeId, status) {
  storeStatuses[storeId] = status;
  if (io) io.emit('statusUpdate', { storeId, status });
}

async function updateStorePhone(storeId, phone) {
  try {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    await Store.update({ bot_phone: cleanPhone }, { where: { wa_id: storeId } });
    if (io) io.emit('storeUpdated', { storeId });
  } catch (e) {
    logger.error(`[Settings] Gagal update phone ${storeId}: ${e.message}`);
  }
}

async function addToChatHistory(storeId, msg) {
  try {
    // ═══ DEDUP GUARD ═══
    // Jika pesan ini sudah ada di database (berdasarkan wa_message_id), skip.
    // Ini mengatasi race condition antara _logBotReply dan message_create event.
    const waMessageId = msg.wa_message_id || msg.id || null;
    if (waMessageId) {
      const existing = await ChatMessage.findOne({ where: { wa_message_id: waMessageId } });
      if (existing) return; // Sudah ada, tidak perlu insert ulang
    }

    const identity = msg.contactIdentity || buildContactIdentity(msg.from, msg.isMe ? {} : {
      name: msg.sender_name,
      number: msg.contact_phone
    });
    const recentIdentityRows = await ChatMessage.findAll({
      where: { store_wa_id: storeId, contact_id: msg.from },
      limit: 20,
      order: [['timestamp', 'DESC']]
    });
    const stableHistoryMsg = recentIdentityRows.find(row => {
      const item = row.get({ plain: true });
      return item.contact_phone || firstStableDisplayName(item.contact_display_name, item.sender_name);
    }) || recentIdentityRows[0];
    const stableIdentity = mergeStableContactIdentity(msg.from, msg, identity, stableHistoryMsg);
    const quotedMessageId = msg.quoted_message_id || msg.quotedMessageId || null;
    let quotedRecord = null;
    if (quotedMessageId) {
      quotedRecord = await ChatMessage.findOne({
        where: { store_wa_id: storeId, wa_message_id: quotedMessageId }
      }).catch(() => null);
    }
    const chatMsg = await ChatMessage.create({
      store_wa_id: storeId,
      contact_id:  msg.from,
      wa_message_id: waMessageId,
      sender_name: msg.isMe
        ? (msg.sender_name || 'CS Manual')
        : (firstStableDisplayName(msg.sender_name, stableIdentity.displayName) || stableIdentity.displayName),
      contact_display_name: stableIdentity.displayName,
      contact_phone: stableIdentity.phone || null,
      contact_lid: stableIdentity.lid || null,
      contact_type: stableIdentity.type,
      contact_source: stableIdentity.source,
      quoted_message_id: quotedMessageId,
      quoted_body: clipQuotedBody(quotedRecord?.body || msg.quoted_body || msg.quotedBody),
      quoted_from_me: msg.quoted_from_me ?? msg.quotedFromMe ?? quotedRecord?.is_from_me ?? null,
      quoted_sender_name: msg.quoted_sender_name || msg.quotedSenderName || quotedRecord?.sender_name || null,
      body:        msg.body,
      is_from_me:  msg.isMe || false,
      type:        msg.type || 'chat',
      timestamp:   msg.timestamp || new Date()
    });
    if (io) io.emit('newMessage', { storeId, msg: chatMsg.dataValues });
  } catch (err) {
    // Tangkap UniqueConstraint error juga sebagai dedup fallback
    if (err.name === 'SequelizeUniqueConstraintError') return;
    logger.error(`addToChatHistory error: ${err.message}`);
  }
}

async function updateContactPhoneIdentity(storeId, contactId, resolved = {}) {
  const latestMsg = await ChatMessage.findOne({
    where: { store_wa_id: storeId, contact_id: contactId },
    order: [['timestamp', 'DESC']]
  });
  const identity = buildContactIdentity(contactId, {
    name: resolved.contact?.name || resolved.contact?.verifiedName || latestMsg?.contact_display_name || latestMsg?.sender_name,
    pushname: resolved.contact?.pushname,
    shortName: resolved.contact?.shortName,
    phone: resolved.phone
  });

  await ChatMessage.update({
    contact_display_name: identity.displayName,
    contact_phone: resolved.phone,
    contact_lid: identity.lid || null,
    contact_type: identity.type,
    contact_source: resolved.source || identity.source
  }, {
    where: { store_wa_id: storeId, contact_id: contactId }
  });
  try {
    const { ChatSummary } = require('../database/index');
    await ChatSummary.update({ contact_name: identity.displayName }, {
      where: { store_wa_id: storeId, contact_id: contactId }
    });
  } catch (_) {}

  if (io) {
    io.emit('contactIdentityUpdated', {
      storeId,
      contactId,
      identity: {
        contact_display_name: identity.displayName,
        contact_phone: resolved.phone,
        contact_lid: identity.lid || null,
        contact_type: identity.type,
        contact_source: resolved.source || identity.source
      }
    });
  }

  return {
    ...identity,
    phone: resolved.phone,
    phoneWid: resolved.phoneWid || ''
  };
}

function emitTypingStatus(storeId, contactId, isTyping) {
  if (io) io.emit('typingStatus', { storeId, contactId, isTyping });
}

function emitQRSpec(storeId, qr) {
  if (io) io.emit('qrUpdate', { storeId, qr });
}

/**
 * Emit event ke frontend ketika pesan dihapus dari WhatsApp (message_revoke_everyone).
 * @param {string} storeId
 * @param {string} waMessageId - ID pesan WA yang dihapus
 * @param {string} contactId - Dari/ke siapa pesan tersebut
 */
function emitMessageRevoked(storeId, waMessageId, contactId) {
  if (io) io.emit('messageRevoked', { storeId, waMessageId, contactId });
}

module.exports = {
  initDashboard,
  updateWAStatus,
  updateStorePhone,
  emitQRSpec,
  addToChatHistory,
  emitTypingStatus,
  emitMessageRevoked,
  updateContactPhoneIdentity
};
