/**
 * @file dashboard_service.js
 * @description Web Dashboard & API Server (Express + Socket.io)
 * Security Phase:
 *  - Session-based authentication (persistent via Sequelize / SQLite)
 *  - Route protection middleware
 *  - Production-ready session store (no MemoryStore warnings)
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
const logger = require('../utils/logger');
const config = require('../config');
const { UPLOADS_DIR } = config;
const { Store, ChatMessage, sequelize } = require('../database/index');
const mediaService = require('./media_service');

// Kredensial Login (Selalu dari env di production)
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

let io;
const storeStatuses = {};
const app = express();
const server = http.createServer(app);

// 1. SECURITY: Rate Limiter (Prevent Brute Force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Menit
  max: 12, // Maks 12 kali coba per 15 menit
  message: 'Terlalu banyak percobaan login. Silakan coba lagi nanti (15 menit).',
  standardHeaders: true,
  legacyHeaders: false,
});

// 2. LIVE SYSTEM LOGGING (Wow Factor)
// Kirim log penting ke Dashboard UI secara real-time via Socket.io
const originalBotLogger = logger.bot;
logger.bot = (msg) => {
    if (io) io.emit('sysLog', { type: 'BOT', msg, time: new Date().toLocaleTimeString() });
    originalBotLogger(msg);
};
const originalErrorLogger = logger.error;
logger.error = (msg) => {
    if (io) io.emit('sysLog', { type: 'ERROR', msg, time: new Date().toLocaleTimeString() });
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
    secure: false                  // Set true jika full HTTPS
  }
}));

// ============================================================
// STATIC FILES (Publik — login.html bisa diakses tanpa auth)
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

// ============================================================
// AUTH ROUTES (Login & Logout — tidak perlu autentikasi)
// ============================================================
app.post('/api/login', (req, res) => {
  const { user, pass } = req.body;
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    req.session.authenticated = true;
    req.session.user = user;
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
const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB hard ceiling

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
// AUTH ROUTES & PROTECTION
// ============================================================

// API LOGIN (Security: Rate Limited)
app.post('/api/login', loginLimiter, (req, res) => {
  const { user, pass } = req.body;
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    req.session.authenticated = true;
    return res.json({ success: true, message: 'Login berhasil!' });
  }
  res.status(401).json({ success: false, message: 'Username atau password salah.' });
});

// GET LOGOUT
// ============================================================
// INIT DASHBOARD
// ============================================================
function initDashboard(port = 3000) {
  io = new Server(server, { cors: { origin: '*' } });

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
  app.post('/api/agents', async (req, res) => {
    try {
      const { name, bot_name, system_prompt, product_knowledge } = req.body;
      const { BotAgent } = require('../database/index');
      const newAgent = await BotAgent.create({
        name: name || 'Agen Baru',
        bot_name: bot_name || 'CS Bot',
        system_prompt: system_prompt || 'Kamu adalah CS yang ramah.',
        product_knowledge: product_knowledge || ''
      });
      res.json({ success: true, agent: newAgent });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Update Agent
  app.put('/api/agents/:id', async (req, res) => {
    try {
      const { name, bot_name, system_prompt, product_knowledge } = req.body;
      const { BotAgent } = require('../database/index');
      const agent = await BotAgent.findByPk(req.params.id);
      if (!agent) return res.status(404).json({ success: false, message: 'Agent tidak ditemukan' });
      await agent.update({ name, bot_name, system_prompt, product_knowledge });
      res.json({ success: true, agent });
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
  app.post('/api/stores', async (req, res) => {
    try {
      const { name, agent_id } = req.body;
      if (!name?.trim()) return res.status(400).json({ success: false, message: 'Nama toko wajib diisi!' });

      const wa_id = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 12)}-${Date.now().toString().slice(-4)}`;
      const newStore = await Store.create({
        wa_id, name: name.trim(),
        agent_id: agent_id ? parseInt(agent_id) : null,
        is_bot_active: true
      });

      // Langsung jalankan mesin WA baru
      const whatsappService = require('../whatsapp_service');
      const client = whatsappService.createWhatsAppClient(wa_id);
      whatsappService.setupEventListeners(client, wa_id);
      client.initialize(); 

      res.json({ success: true, store: newStore });
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
  app.get('/api/system/backups/:name', (req, res) => {
    try {
      const filePath = path.join(process.cwd(), 'backups', req.params.name);
      if (!fs.existsSync(filePath)) return res.status(404).send('Not Found');
      res.download(filePath);
    } catch (e) { res.status(500).send(e.message); }
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
  app.post('/api/settings/:storeId', async (req, res) => {
    try {
      const { name, is_bot_active, agent_id } = req.body;
      const store = await Store.findOne({ where: { wa_id: req.params.storeId } });
      if (!store) return res.status(404).json({ success: false, message: 'Store tidak ditemukan.' });
      
      await store.update({ 
          name, 
          is_bot_active: is_bot_active ?? true,
          agent_id: agent_id ? parseInt(agent_id) : null
      });
      res.json({ success: true });
      if (io) io.emit('storeUpdated', { storeId: req.params.storeId });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ============================================================
  // CHAT APIs
  // ============================================================

  // GET: Chat History (Per Store)
  app.get('/api/chat/:storeId', async (req, res) => {
    try {
      let history = await ChatMessage.findAll({
        where: { store_wa_id: req.params.storeId },
        limit: 150,
        order: [['timestamp', 'DESC']]
      });
      res.json(history.reverse());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST: Kirim Pesan Manual
  app.post('/api/send', async (req, res) => {
    try {
      const { storeId, to, body } = req.body;
      if (!storeId || !to || !body) return res.status(400).json({ success: false, message: 'storeId, to, body wajib diisi.' });
      const whatsappService = require('../whatsapp_service');
      await whatsappService.sendManualMessage(storeId, to, body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // POST: Kirim Media Manual
  app.post('/api/send-media', async (req, res) => {
    try {
      const { storeId, to, mediaId } = req.body;
      if (!storeId || !to || !mediaId) return res.status(400).json({ success: false, message: 'Data tidak lengkap.' });
      
      const { MediaAsset, Store } = require('../database/index');
      const store = await Store.findOne({ where: { wa_id: storeId } });
      if (!store) return res.status(404).json({ success: false, message: 'Store tidak ditemukan.' });

      const asset = await MediaAsset.findOne({ where: { id: mediaId, agent_id: store.agent_id } });
      if (!asset) return res.status(404).json({ success: false, message: 'Media tidak ditemukan untuk agen ini.' });

      const whatsappService = require('../whatsapp_service');
      await whatsappService.sendManualMedia(storeId, to, asset);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ============================================================
  // MEDIA APIs — Per-Store + Vision AI + Whisper + Purpose Control
  // ============================================================

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
  app.post('/api/media/:agentId', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'File tidak ditemukan.' });

    const tempPath = req.file.path;
    try {
      const { label, description, purpose } = req.body;
      const mimeType  = req.file.mimetype;
      const fileType  = mimeType.startsWith('image') ? 'image' : 'video';
      const fileSizeKb = Math.round(req.file.size / 1024);
      const agentId   = req.params.agentId;

      // Validasi ukuran
      const maxSizeKb = fileType === 'image' ? 5120 : 16384;
      if (fileSizeKb > maxSizeKb) {
        fs.unlinkSync(tempPath);
        return res.status(400).json({ success: false, message: `File terlalu besar. Maks ${fileType === 'image' ? '5MB' : '16MB'}.` });
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
  app.put('/api/media/:agentId/:id', async (req, res) => {
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
  app.delete('/api/media/:agentId/:id', async (req, res) => {
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

async function addToChatHistory(storeId, msg) {
  try {
    const chatMsg = await ChatMessage.create({
      store_wa_id: storeId,
      contact_id:  msg.from,
      sender_name: msg.sender_name || msg.from,
      body:        msg.body,
      is_from_me:  msg.isMe || false,
      type:        msg.type || 'chat',
      timestamp:   msg.timestamp || new Date()
    });
    if (io) io.emit('newMessage', { storeId, msg: chatMsg.dataValues });
  } catch (err) {
    logger.error(`addToChatHistory error: ${err.message}`);
  }
}

function emitQRSpec(storeId, qr) {
  if (io) io.emit('qrUpdate', { storeId, qr });
}

module.exports = {
  initDashboard,
  updateWAStatus,
  emitQRSpec,
  addToChatHistory
};
