import { Request, Response, NextFunction } from 'express';
import { Op, QueryTypes } from 'sequelize';
import { ChatMessage, ChatSummary, PausedContact, Store, MediaAsset, sequelize } from '../models';
import { socketService } from '../services/socket.service';

function isContactPaused(pausedUntil: Date | string | null | undefined): boolean {
  if (pausedUntil == null) return true;
  return new Date(pausedUntil).getTime() > Date.now();
}

export const getChatHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { contactId, before, paginated } = req.query;
    const maxLimit = contactId ? 200 : 2000;
    const defaultLimit = contactId ? 50 : 2000;
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || String(defaultLimit), 10) || 50, 1), maxLimit);
    
    const where: any = { store_wa_id: req.params.storeId };
    if (contactId) {
      where.contact_id = contactId;
    }
    if (before) {
      const beforeDate = new Date(before as string);
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
          nextBefore: (items[0] as any)?.timestamp || null
        }
      });
    }

    res.json(items);
  } catch (e) {
    next(e);
  }
};

export const getContacts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeId } = req.params;
    const { page = '1', limit = '50', search = '' } = req.query;
    const tableName = ChatMessage.getTableName();
    
    const limitNum = parseInt(limit as string, 10) || 50;
    const offsetNum = (Math.max(parseInt(page as string, 10) || 1, 1) - 1) * limitNum;
    const searchFilter = search ? `AND (m.contact_display_name LIKE :search OR m.contact_id LIKE :search OR m.contact_phone LIKE :search OR m.sender_name LIKE :search)` : '';

    // Query optimal: satu JOIN untuk latest message + satu JOIN untuk unread count
    // Menggantikan correlated subquery (N+1) dengan single-pass aggregation
    const contacts: any[] = await sequelize.query(`
      SELECT
        m.contact_id,
        m.sender_name,
        m.contact_display_name,
        m.body           AS last_message,
        m.timestamp      AS last_seen,
        CASE WHEN m.is_from_me = 1 THEN 0 ELSE COALESCE(u.unread_count, 0) END AS unread_count
      FROM ${tableName} m
      INNER JOIN (
        SELECT contact_id, MAX(id) AS max_id
        FROM ${tableName}
        WHERE store_wa_id = :storeId
        GROUP BY contact_id
      ) latest ON m.id = latest.max_id
      LEFT JOIN (
        SELECT contact_id, COUNT(*) AS unread_count
        FROM ${tableName}
        WHERE store_wa_id = :storeId
          AND is_read = 0
          AND is_from_me = 0
        GROUP BY contact_id
      ) u ON m.contact_id = u.contact_id
      WHERE m.store_wa_id = :storeId
      ${searchFilter}
      ORDER BY m.timestamp DESC
      LIMIT :limit OFFSET :offset
    `, { 
      replacements: { 
        storeId,
        limit: limitNum,
        offset: offsetNum,
        ...(search ? { search: `%${search}%` } : {})
      }, 
      type: QueryTypes.SELECT 
    });

    // Jalankan 2 query pelengkap secara paralel untuk efisiensi
    const [summaries, pausedContacts] = await Promise.all([
      ChatSummary.findAll({ where: { store_wa_id: storeId } }),
      PausedContact.findAll({ where: { store_wa_id: storeId } }),
    ]);

    const labelMap: Record<string, string[]> = {};
    for (const s of summaries) {
      try {
        labelMap[(s as any).contact_id] = JSON.parse((s as any).wa_labels || '[]');
      } catch {
        labelMap[(s as any).contact_id] = [];
      }
    }

    const pausedMap = pausedContacts.reduce((acc: Record<string, Date | null>, pc: any) => {
      acc[pc.contact_id] = pc.paused_until;
      return acc;
    }, {});

    const mappedContacts = contacts.map(c => {
      const pauseUntil = pausedMap[c.contact_id];
      const hasPauseRecord = c.contact_id in pausedMap;
      return {
        ...c,
        unread_count: Number(c.unread_count) || 0,
        labels: labelMap[c.contact_id] || [],
        is_bot_paused: hasPauseRecord && isContactPaused(pauseUntil),
        paused_until: pauseUntil ?? null,
      };
    });

    res.json(mappedContacts);
  } catch (e) {
    next(e);
  }
};


export const markAsRead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const contactId = req.params.contactId as string;
    const [updated] = await ChatMessage.update(
      { is_read: true } as any,
      { where: { store_wa_id: storeId, contact_id: contactId, is_read: false, is_from_me: false } }
    );
    socketService.emitChatRead(storeId, contactId);
    res.json({ success: true, updated });
  } catch (e) {
    next(e);
  }
};

export const sendManualMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { contactId, message, quotedMessageId, quotedBody, quotedFromMe, quotedSenderName } = req.body;
    const wa_id = req.params.storeId;
    if (!contactId || !message) {
      return res.status(400).json({ success: false, message: 'contactId & message diperlukan' });
    }
    
    const whatsappService = require('../whatsapp_service');
    const success = await whatsappService.sendManualMessage(wa_id, contactId, message, {
      quotedMessageId,
      quotedBody,
      quotedFromMe,
      quotedSenderName,
    });
    
    if (success) {
      const PAUSE_MINUTES = 30;
      const pauseUntil = new Date(Date.now() + PAUSE_MINUTES * 60000);
      await PausedContact.upsert({
        store_wa_id: wa_id,
        contact_id: contactId,
        paused_until: pauseUntil,
        paused_by: 'manual',
      });
      res.json({ success: true, message: 'Pesan terkirim (AI di-pause 30m)' });
    } else {
      res.status(500).json({ success: false, message: 'Gagal kirim pesan' });
    }
  } catch (e) {
    next(e);
  }
};

export const sendManualMediaMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { contactId, mediaId } = req.body;
    const storeId = req.params.storeId;
    if (!contactId || !mediaId) {
      return res.status(400).json({ success: false, message: 'contactId & mediaId diperlukan' });
    }

    const store = await Store.findOne({ where: { wa_id: storeId } });
    if (!store) return res.status(404).json({ success: false, message: 'Store tidak ditemukan.' });

    const asset = await MediaAsset.findOne({
      where: { id: mediaId, agent_id: (store as any).agent_id },
    });
    if (!asset) {
      return res.status(404).json({ success: false, message: 'Media tidak ditemukan untuk agen toko ini.' });
    }

    const whatsappService = require('../whatsapp_service');
    await whatsappService.sendManualMedia(storeId, contactId, asset);

    const PAUSE_MINUTES = 30;
    const pauseUntil = new Date(Date.now() + PAUSE_MINUTES * 60000);
    await PausedContact.upsert({
      store_wa_id: storeId,
      contact_id: contactId,
      paused_until: pauseUntil,
      paused_by: 'manual',
    });

    res.json({ success: true, message: 'Media terkirim (AI di-pause 30m)' });
  } catch (e) {
    next(e);
  }
};

export const pauseAi = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { durationMinutes = 30 } = req.body;
    const pauseUntil = new Date(Date.now() + parseInt(durationMinutes) * 60000);
    await PausedContact.upsert({
      store_wa_id: req.params.storeId,
      contact_id: req.params.contactId,
      paused_until: pauseUntil,
      paused_by: 'manual',
    });
    const { pauseBotForContact } = require('../events/message_handler');
    await pauseBotForContact(req.params.storeId, req.params.contactId);
    res.json({ success: true, message: `AI dipause selama ${durationMinutes} menit.`, paused_until: pauseUntil });
  } catch (e) {
    next(e);
  }
};

export const unpauseAi = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await PausedContact.destroy({
      where: { store_wa_id: req.params.storeId, contact_id: req.params.contactId },
    });
    const { resumeBotForContact } = require('../events/message_handler');
    await resumeBotForContact(req.params.storeId, req.params.contactId);
    res.json({ success: true, message: 'AI dilanjutkan (unpaused).' });
  } catch (e) {
    next(e);
  }
};

export const requestPhone = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeId, contactId } = req.params;
    const whatsappService = require('../whatsapp_service');
    const dashboard = require('../services/dashboard_service');

    let resolved: any = null;
    let resolveError: Error | null = null;
    try {
      resolved = await whatsappService.resolveContactPhone(storeId, contactId);
    } catch (error: any) {
      resolveError = error;
    }

    if (resolved?.phone) {
      const identity = await dashboard.updateContactPhoneIdentity(storeId, contactId, resolved);
      return res.json({
        success: true,
        resolved: true,
        requested: false,
        phone: resolved.phone,
        identity,
      });
    }

    const result = await whatsappService.requestPhoneNumber(storeId, contactId);
    res.json({
      success: true,
      resolved: false,
      requested: true,
      result,
      message: resolveError
        ? `Nomor belum ada di cache (${resolveError.message}). Permintaan nomor sudah dikirim ke WA.`
        : 'Permintaan nomor asli sudah dikirim ke WhatsApp.',
    });
  } catch (e) {
    next(e);
  }
};

export const clearChat = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = req.params.storeId as string;
    const contactId = req.params.contactId as string;
    const decodedContactId = decodeURIComponent(contactId);

    const deletedMsgs = await ChatMessage.destroy({
      where: { store_wa_id: storeId, contact_id: decodedContactId },
    });
    const deletedSummary = await ChatSummary.destroy({
      where: { store_wa_id: storeId, contact_id: decodedContactId },
    });
    await PausedContact.destroy({
      where: { store_wa_id: storeId, contact_id: decodedContactId },
    }).catch(() => {});

    socketService.emitChatCleared(storeId, decodedContactId);

    res.json({ success: true, deletedMsgs, deletedSummary });
  } catch (e) {
    next(e);
  }
};

// ─── Reaction & Forward ───────────────────────────────────────────

export const sendReaction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { messageId, emoji } = req.body;
    if (!messageId) {
      return res.status(400).json({ success: false, message: 'messageId diperlukan' });
    }
    const whatsappService = require('../whatsapp_service');
    const result = await whatsappService.sendReaction(req.params.storeId, messageId, emoji || '\u{1F44D}');
    res.json({ success: true, result });
  } catch (e) {
    next(e);
  }
};

export const forwardMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { to, messageId, messageIds, displayCaptionText } = req.body;
    const ids = messageIds || (messageId ? [messageId] : []);
    if (!ids.length || !to) {
      return res.status(400).json({ success: false, message: 'to dan messageId/messageIds diperlukan' });
    }
    const whatsappService = require('../whatsapp_service');
    const result = await whatsappService.forwardMessages(req.params.storeId, to, ids, {
      displayCaptionText: Boolean(displayCaptionText),
    });
    res.json({ success: true, result });
  } catch (e) {
    next(e);
  }
};

export const syncWaChatHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeId, contactId } = req.params;
    const { limit = 50 } = req.body;
    const wserv = require('../whatsapp_service');
    const result = await wserv.syncMessagesFromWa(storeId, contactId, limit);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || 'Gagal sinkronisasi chat' });
  }
};

export const syncAllWaChats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeId } = req.params;
    const wserv = require('../whatsapp_service');
    const result = await wserv.syncAllChatsFromWa(storeId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || 'Gagal sinkronisasi semua chat' });
  }
};

export const sweepUnansweredChats = async (req: Request, res: Response) => {
  try {
    const { storeId } = req.params;
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'Store ID diperlukan' });
    }
    const message_handler = require('../events/message_handler');
    // Jalankan di background agar tidak memblokir HTTP request
    message_handler.sweepUnansweredChats(storeId).catch((err: any) => {
      console.error('Error sweepUnansweredChats bg:', err);
    });
    res.json({ success: true, message: 'Proses Sapu Bersih dimulai di background' });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message || 'Gagal memulai sapu bersih' });
  }
};

export const simulateIncoming = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeId } = req.params;
    const { contactId, body } = req.body;
    const message_handler = require('../events/message_handler');
    const mockMessage = {
      id: { _serialized: 'msg_' + Date.now(), id: 'msg_' + Date.now() },
      from: contactId,
      to: storeId,
      body: body,
      type: 'chat',
      isStatus: false,
      timestamp: Math.floor(Date.now() / 1000),
      hasMedia: false,
      author: null,
      getContact: async () => ({
        id: { _serialized: contactId },
        name: 'Test E2E Buyer',
        number: contactId.split('@')[0],
        isMyContact: false,
        isBusiness: false,
        isEnterprise: false
      })
    };
    await message_handler.handleMessage(mockMessage, storeId, true);
    res.json({ success: true, message: 'Simulated incoming message injected successfully' });
  } catch (err) {
    next(err);
  }
};
