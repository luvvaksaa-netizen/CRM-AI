import { Request, Response, NextFunction } from 'express';
import { Store, BotAgent } from '../models';

export const getAllStores = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stores = await Store.findAll({
      order: [['id', 'ASC']],
      include: [{ model: BotAgent }]
    });
    res.json(stores);
  } catch (e) {
    next(e);
  }
};

export const createStore = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, wa_id, agent_id, temp_session_id } = req.body;
    
    // Jika ada temp_session_id, berarti ini flow QR scan → promote temp client
    if (temp_session_id) {
      if (!wa_id?.trim()) {
        return res.status(400).json({ success: false, message: 'WhatsApp ID (wa_id) wajib diisi' });
      }

      const existing = await Store.findOne({ where: { wa_id } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Toko dengan wa_id ini sudah ada' });
      }

      // Promosikan temp client jadi permanent
      const path = require('path');
      const whatsappService = require('../whatsapp_service');
      const io = req.app.get('io');
      
      try {
        await whatsappService.promoteTempClient(temp_session_id, wa_id, io);
        console.log(`[WA] Temp client ${temp_session_id} dipromosikan ke ${wa_id}`);
      } catch (err: any) {
        console.error(`[WA] Gagal promosi temp client: ${err.message}`);
        // Coba bersihkan temp client yang gagal
        try {
          whatsappService.destroyTempClient(temp_session_id);
        } catch (cleanupErr: any) {
          console.error(`[WA] Gagal cleanup temp client: ${cleanupErr.message}`);
        }
        // Tetap lanjutkan — store tetap dibuat meski client gagal promosi
        // (user bisa re-auth nanti via restart server)
      }

      const store = await Store.create({ 
        wa_id, 
        name: name || wa_id, 
        agent_id: agent_id || null 
      } as any);

      return res.json({ success: true, store });
    }

    // === Flow lama: wa_id manual (fallback) ===
    if (!wa_id?.trim()) {
      return res.status(400).json({ success: false, message: 'WhatsApp ID (wa_id) wajib diisi' });
    }

    const existing = await Store.findOne({ where: { wa_id } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Toko dengan wa_id ini sudah ada' });
    }

    const store = await Store.create({ 
      wa_id, 
      name: name || 'Toko Baru', 
      agent_id: agent_id || null 
    } as any);

    // Init WhatsApp client for this new store
    try {
      const path = require('path');
      const whatsappService = require('../whatsapp_service');
      const io = req.app.get('io');
      const client = whatsappService.createWhatsAppClient(wa_id);
      whatsappService.setupEventListeners(client, wa_id, io);
      await client.initialize();
      console.log(`[WA] Client created and initializing for ${wa_id}`);
    } catch (err: any) {
      console.error(`[WA] Failed to init newly created store ${wa_id}: ${err.message}`);
    }

    res.json({ success: true, store });
  } catch (e) {
    next(e);
  }
};

/**
 * POST /api/stores/prepare-qr
 * Membuat WhatsApp client temporer untuk scan QR.
 * Client ini BELUM disimpan ke DB — hanya untuk mendapatkan identitas WA.
 * QR di-emit via Socket.IO. Auto-destroy setelah 2 menit jika tidak discan.
 */
export const prepareQR = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const path = require('path');
    const whatsappService = require('../whatsapp_service');
    const io = req.app.get('io');

    const { client, tempId } = whatsappService.createTempClient(io);

    // Initialize client — QR akan di-emit via socket
    client.initialize().catch((err: any) => {
      console.error(`[WA] Temp client ${tempId} init error: ${err.message}`);
      whatsappService.destroyTempClient(tempId);
    });

    console.log(`[WA] Temp client ${tempId} created for QR scan`);

    res.json({ 
      success: true, 
      tempSessionId: tempId,
      message: 'Temp client dibuat. QR akan muncul via Socket.IO.'
    });
  } catch (e) {
    next(e);
  }
};

/**
 * POST /api/stores/cancel-qr
 * Batalkan temp client (user menutup modal atau batal scan).
 */
export const cancelQR = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { temp_session_id } = req.body;
    
    if (!temp_session_id) {
      return res.status(400).json({ success: false, message: 'temp_session_id wajib diisi' });
    }

    const path = require('path');
    const whatsappService = require('../whatsapp_service');
    await whatsappService.destroyTempClient(temp_session_id);

    console.log(`[WA] Temp client ${temp_session_id} dibatalkan oleh user`);
    res.json({ success: true, message: 'Temp client dibatalkan' });
  } catch (e) {
    next(e);
  }
};

export const updateStore = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { name, agent_id, is_bot_active } = req.body;

    const store = await Store.findByPk(id);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store tidak ditemukan' });
    }

    await store.update({ name, agent_id, is_bot_active });
    res.json({ success: true, store });
  } catch (e) {
    next(e);
  }
};

export const deleteStore = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const store = await Store.findByPk(id) as any;
    
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store tidak ditemukan' });
    }

    // Destroy WhatsApp client
    try {
      const path = require('path');
      const whatsappService = require('../whatsapp_service');
      await whatsappService.logoutClient(store.wa_id);
      console.log(`[WA] Client destroyed for ${store.wa_id}`);
    } catch (err: any) {
      console.error(`[WA] Failed to destroy client for ${store.wa_id}: ${err.message}`);
    }

    await store.destroy();
    res.json({ success: true, message: 'Store berhasil dihapus' });
  } catch (e) {
    next(e);
  }
};

/**
 * POST /stores/:id/logout
 * Logout WA tanpa delete store — hanya putuskan koneksi WhatsApp.
 */
export const logoutStore = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const store = await Store.findByPk(id) as any;
    
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store tidak ditemukan' });
    }

    try {
      const path = require('path');
      const whatsappService = require('../whatsapp_service');
      await whatsappService.logoutClient(store.wa_id);
      console.log(`[WA] Logout berhasil untuk ${store.wa_id}`);
    } catch (err: any) {
      console.error(`[WA] Logout gagal untuk ${store.wa_id}: ${err.message}`);
      return res.status(500).json({ success: false, message: 'Gagal logout: ' + err.message });
    }

    res.json({ success: true, message: 'Logout berhasil. Silakan scan ulang untuk menghubungkan kembali.' });
  } catch (e) {
    next(e);
  }
};

/**
 * POST /stores/:id/reconnect
 * Reconnect WhatsApp client untuk store yang disconnected.
 */
export const reconnectStore = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const store = await Store.findByPk(id) as any;
    
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store tidak ditemukan' });
    }

    try {
      const path = require('path');
      const whatsappService = require('../whatsapp_service');
      const io = req.app.get('io');

      // Coba restart client runtime dulu
      try {
        await whatsappService.restartClientRuntime(store.wa_id, 'user-reconnect', true);
        console.log(`[WA] Client restart untuk ${store.wa_id}`);
      } catch (_) {
        // Jika restart gagal, buat client baru
        console.log(`[WA] Restart gagal untuk ${store.wa_id}, membuat client baru...`);
        const client = whatsappService.createWhatsAppClient(store.wa_id);
        whatsappService.setupEventListeners(client, store.wa_id, io);
        await client.initialize();
        whatsappService.beginClientSession(store.wa_id);
      }

      console.log(`[WA] Reconnect berhasil untuk ${store.wa_id}`);
    } catch (err: any) {
      console.error(`[WA] Reconnect gagal untuk ${store.wa_id}: ${err.message}`);
      return res.status(500).json({ success: false, message: 'Gagal reconnect: ' + err.message });
    }

    res.json({ success: true, message: 'Reconnect berhasil. Perangkat sedang terhubung.' });
  } catch (e) {
    next(e);
  }
};


// ─── GET /api/stores/status — WA connection status for all stores ───
export const getWAStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stores = await Store.findAll({ attributes: ['wa_id', 'name'] });
    const waIds = stores.map((s: any) => s.wa_id);

    try {
      const whatsappService = require('../whatsapp_service');
      const { socketService } = require('../services/socket.service');
      const qrCodes = socketService.getQRCodes();

      if (whatsappService.buildSessionStatusMap) {
        const { statuses, health } = await whatsappService.buildSessionStatusMap(waIds, { qrCodes });
        return res.json({ statuses, health });
      }

      // Fallback lama
      const statusMap: Record<string, string> = {};
      const clients = whatsappService.getClients ? whatsappService.getClients() : new Map();
      for (const waId of waIds) {
        if (clients.has(waId)) {
          statusMap[waId] = qrCodes[waId] ? 'needs_scan' : 'ready';
        } else {
          statusMap[waId] = 'disconnected';
        }
      }
      return res.json({ statuses: statusMap, health: {} });
    } catch (e: any) {
      const statusMap: Record<string, string> = {};
      for (const waId of waIds) statusMap[waId] = 'disconnected';
      return res.json({ statuses: statusMap, health: {} });
    }
  } catch (e) {
    next(e);
  }
};
