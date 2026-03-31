/**
 * @file dashboard_service.js
 * @description Web Dashboard & API Server (Express + Socket.io)
 * Phase 5 Fixes:
 *  - Media API terisolasi per toko (store_wa_id)
 *  - Vision AI auto-analysis terintegrasi
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session'); // Tambahkan session
const logger = require('../utils/logger');
const config = require('../config');
const { Store, ChatMessage } = require('../database/index');
const mediaService = require('./media_service');

// Kredensial Login (Ambil dari .env atau default)
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

let io;
const storeStatuses = {}; // { [storeWaId]: statusString }
const app = express();
const server = http.createServer(app);

// ============================================================
// MIDDLEWARE & SESSION
// ============================================================
app.use(express.json());
app.use(session({
  secret: 'rekapoin-crm-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 Jam
}));

// Middleware Proteksi Halaman
const authenticate = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    return next();
  }
  // Jika akses API kirim 401, jika akses halaman redirect ke login
  if (req.path.startsWith('/api')) {
    return res.status(401).json({ error: 'Unauthorized. Silakan login.' });
  }
  res.redirect('/login.html');
};

// ============================================================
// MULTER: File Upload Configuration
// ============================================================
const ALLOWED_TYPES = /jpeg|jpg|png|gif|webp|mp4|mov|avi|mkv|3gp/;
const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB hard ceiling

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
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

// API LOGIN
app.post('/api/login', (req, res) => {
  const { user, pass } = req.body;
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    req.session.authenticated = true;
    return res.json({ success: true, message: 'Login berhasil!' });
  }
  res.status(401).json({ success: false, message: 'Username atau password salah.' });
});

// GET LOGOUT
app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

// Proteksi Halaman Dashboard Utama (index.html)
app.get('/', authenticate, (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Proteksi folder uploads & public statis (KECUALI login.html)
app.use('/uploads', authenticate, express.static(path.join(process.cwd(), 'public', 'uploads')));

// Routing publik (Login page & assets penunjang)
app.use('/login.html', express.static(path.join(process.cwd(), 'public', 'login.html')));
app.use('/assets', express.static(path.join(process.cwd(), 'public', 'assets')));

// ============================================================
// INIT DASHBOARD
// ============================================================
function initDashboard(port = 3000) {
  io = new Server(server, { cors: { origin: '*' } });

  // PENTING: Gunakan middleware 'authenticate' untuk SEMUA API internal
  // Agar data chat tidak bisa dicuri via API publik
  app.use('/api', (req, res, next) => {
    // Route login & logout harus bisa diakses tanpa login
    if (req.path === '/login' || req.path === '/logout') return next();
    return authenticate(req, res, next);
  });

  // Home Route (Redirect ke dashboard utama)
  app.get('/', (req, res) => {
    res.redirect('/index.html');
  });

  // SEMUA ROUTE DI BAWAH INI SEKARANG TERPROTEKSI KARENA DI ATAS ADA PROTEKSI /api
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
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ success: false, message: 'Nama toko wajib diisi!' });

      const wa_id = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 12)}-${Date.now().toString().slice(-4)}`;
      const newStore = await Store.create({
        wa_id, name: name.trim(),
        bot_name: 'CS Bot',
        system_prompt: 'Kamu adalah Customer Service yang ramah dan membantu.',
        product_knowledge: '',
        is_bot_active: true
      });

      // Langsung jalankan mesin WA baru
      const whatsappService = require('../whatsapp_service');
      const client = whatsappService.createWhatsAppClient(wa_id);
      whatsappService.setupEventListeners(client, wa_id);
      client.initialize().catch(err => logger.error(`[${wa_id}] Init error: ${err.message}`));

      logger.success(`Store baru "${name}" (${wa_id}) ditambahkan!`);
      res.json({ success: true, store: newStore.dataValues });
    } catch (error) {
      logger.error(`Gagal tambah store: ${error.message}`);
      res.status(500).json({ success: false, message: error.message });
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

  // POST: Update Settings Store
  app.post('/api/settings/:storeId', async (req, res) => {
    try {
      const { bot_name, system_prompt, product_knowledge, is_bot_active, name } = req.body;
      await Store.upsert({ wa_id: req.params.storeId, name, bot_name, system_prompt, product_knowledge, is_bot_active: is_bot_active ?? true });
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
      const history = await ChatMessage.findAll({
        where: { store_wa_id: req.params.storeId },
        limit: 150,
        order: [['timestamp', 'ASC']]
      });
      res.json(history);
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

  // ============================================================
  // MEDIA APIs — Per-Store + Vision AI + Whisper + Purpose Control
  // ============================================================

  // GET: Semua media milik toko tertentu
  app.get('/api/media/:storeId', async (req, res) => {
    try {
      const assets = await mediaService.getMediaByStore(req.params.storeId);
      res.json(assets);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST: Upload media baru (semua tipe) + analisis AI otomatis di background
  app.post('/api/media/:storeId', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'File tidak ditemukan.' });

    const tempPath = req.file.path;
    try {
      const { label, description, purpose } = req.body;
      const mimeType  = req.file.mimetype;
      const fileType  = mimeType.startsWith('image') ? 'image' : 'video';
      const fileSizeKb = Math.round(req.file.size / 1024);
      const storeId   = req.params.storeId;

      // Validasi ukuran
      const maxSizeKb = fileType === 'image' ? 5120 : 16384;
      if (fileSizeKb > maxSizeKb) {
        fs.unlinkSync(tempPath);
        return res.status(400).json({ success: false, message: `File terlalu besar. Maks ${fileType === 'image' ? '5MB' : '16MB'}.` });
      }

      // Validasi toko
      const store = await Store.findOne({ where: { wa_id: storeId } });
      if (!store) {
        fs.unlinkSync(tempPath);
        return res.status(404).json({ success: false, message: 'Store tidak ditemukan.' });
      }

      // Validasi purpose
      const validPurposes = ['both', 'knowledge_only', 'send_only'];
      const mediaPurpose = validPurposes.includes(purpose) ? purpose : 'both';

      const assetData = {
        store_wa_id:   storeId,
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
        : 'Video diupload! AI sedang menarikripsi narasi & menganalisis visual...';

      mediaService.registerMedia(assetData, (asset) => {
        // Callback saat analisis selesai
        if (io) {
          io.emit('mediaUpdated',      { storeId });
          io.emit('mediaAnalysisReady', { storeId, assetId: asset.id });
        }
      }).then(() => {
        // Emit update awal setelah record dibuat (sebelum analisis selesai)
        if (io) io.emit('mediaUpdated', { storeId });
      }).catch(err => logger.error(`Upload register error: ${err.message}`));

      res.json({ success: true, message: analysisMsg, purpose: mediaPurpose });

    } catch (error) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      logger.error(`Upload error: ${error.message}`);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // PATCH: Update tujuan (purpose) media tanpa re-upload
  app.patch('/api/media/:storeId/:id/purpose', async (req, res) => {
    try {
      const { purpose } = req.body;
      const validPurposes = ['both', 'knowledge_only', 'send_only'];
      if (!validPurposes.includes(purpose)) return res.status(400).json({ success: false, message: 'Purpose tidak valid.' });

      const asset = await mediaService.updateMediaPurpose(parseInt(req.params.id), req.params.storeId, purpose);
      if (io) io.emit('mediaUpdated', { storeId: req.params.storeId });
      res.json({ success: true, asset: asset.dataValues });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  });

  // DELETE: Hapus media dengan verifikasi kepemilikan toko
  app.delete('/api/media/:storeId/:id', async (req, res) => {
    try {
      await mediaService.deleteMedia(parseInt(req.params.id), req.params.storeId);
      if (io) io.emit('mediaUpdated', { storeId: req.params.storeId });
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
