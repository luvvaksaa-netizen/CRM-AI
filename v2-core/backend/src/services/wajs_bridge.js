const logger = require('../utils/logger');
const fs = require('fs');

const WAJS_TIMEOUT_MS = Number(process.env.WAJS_INJECT_TIMEOUT_MS || 30000);

function isEnabled() {
  return process.env.WAJS_ENABLED !== 'false';
}

function resolveWaJsBundle() {
  try {
    return require.resolve('@wppconnect/wa-js');
  } catch (_) {
    return null;
  }
}

async function hasReadyWajs(client) {
  if (!client?.pupPage) return false;
  return client.pupPage.evaluate(() => Boolean(window.WPP)).catch(() => false);
}

async function injectWajs(client, storeWaId) {
  if (!isEnabled()) return false;
  if (!client?.pupPage) {
    logger.warn(`[${storeWaId}] WA-JS tidak bisa diinjeksi: Puppeteer page belum tersedia.`);
    return false;
  }

  if (await hasReadyWajs(client)) {
    client.__wajsReady = true;
    return true;
  }

  const bundlePath = resolveWaJsBundle();
  if (!bundlePath) {
    logger.warn(`[${storeWaId}] Paket @wppconnect/wa-js belum terpasang. Lanjut memakai WWebJS saja.`);
    client.__wajsReady = false;
    return false;
  }

  try {
    try {
      await client.pupPage.addScriptTag({ path: bundlePath });
      await client.pupPage.waitForFunction(() => Boolean(window.WPP), { timeout: WAJS_TIMEOUT_MS });
    } catch (scriptTagError) {
      logger.warn(`[${storeWaId}] WA-JS addScriptTag belum berhasil (${scriptTagError.message}). Mencoba inline injection...`);
      const bundleCode = fs.readFileSync(bundlePath, 'utf8');
      await client.pupPage.evaluate((code) => {
        window.eval(code);
        return Boolean(window.WPP);
      }, bundleCode);
      await client.pupPage.waitForFunction(() => Boolean(window.WPP), { timeout: WAJS_TIMEOUT_MS });
    }
    const version = await client.pupPage.evaluate(() => window.WPP?.version || 'unknown').catch(() => 'unknown');
    client.__wajsReady = true;
    logger.success(`[${storeWaId}] WA-JS aktif (WPP ready, version: ${version}).`);
    return true;
  } catch (error) {
    client.__wajsReady = false;
    logger.warn(`[${storeWaId}] WA-JS gagal diinjeksi: ${error.message}. Sistem tetap memakai WWebJS.`);
    return false;
  }
}

async function getReadyPage(client, storeWaId) {
  if (!client?.pupPage) {
    throw new Error('WhatsApp client belum siap membuka halaman WA Web.');
  }

  if (!await hasReadyWajs(client)) {
    const injected = await injectWajs(client, storeWaId);
    if (!injected) {
      throw new Error('WA-JS belum aktif untuk sesi ini.');
    }
  }

  return client.pupPage;
}

async function getClientWajsStatus(client) {
  const installed = Boolean(resolveWaJsBundle());
  const injected = Boolean(client?.__wajsReady) || await hasReadyWajs(client);
  const features = injected && client?.pupPage
    ? await client.pupPage.evaluate(() => ({
      chat: Boolean(window.WPP?.chat),
      contact: Boolean(window.WPP?.contact),
      requestPhoneNumber: Boolean(window.WPP?.chat?.requestPhoneNumber),
      getPnLidEntry: Boolean(window.WPP?.contact?.getPnLidEntry),
      labels: Boolean(window.WPP?.labels?.getAllLabels),
      markIsComposing: Boolean(window.WPP?.chat?.markIsComposing)
    })).catch(() => ({}))
    : {};
  return {
    enabled: isEnabled(),
    installed,
    injected,
    runtime: injected ? 'WA-JS + WWebJS' : 'WWebJS',
    features
  };
}

function normalizeWidPayload(value) {
  if (!value) return null;
  if (typeof value === 'string') return { serialized: value, user: value.split('@')[0] };
  const serialized = value._serialized || value.serialized || value.id?._serialized || value.id || '';
  const user = value.user || value.id?.user || String(serialized || '').split('@')[0] || '';
  const server = value.server || value.id?.server || String(serialized || '').split('@')[1] || '';
  return { serialized, user, server };
}

function getSerializedMessageId(message) {
  return message?.id?._serialized || message?.id?.id || '';
}

async function sendReactionToMessage(message, emoji = '\uD83D\uDC4D', storeWaId = 'default') {
  const client = message?.client;

  if (client && await hasReadyWajs(client)) {
    const messageId = getSerializedMessageId(message);
    if (!messageId) return false;

    await client.pupPage.evaluate(({ id, reaction }) => {
      if (!window.WPP?.chat?.sendReactionToMessage) {
        throw new Error('WPP.chat.sendReactionToMessage tidak tersedia.');
      }
      return window.WPP.chat.sendReactionToMessage(id, reaction);
    }, { id: messageId, reaction: emoji });
    return true;
  }

  if (typeof message?.react === 'function') {
    await message.react(emoji);
    return true;
  }

  logger.warn(`[${storeWaId}] Reaksi emoji tidak tersedia untuk pesan ini.`);
  return false;
}

async function safeSendReactionToMessage(message, emoji, storeWaId) {
  try {
    return await sendReactionToMessage(message, emoji, storeWaId);
  } catch (error) {
    logger.warn(`[${storeWaId}] Gagal mengirim reaksi WA-JS: ${error.message}`);
    return false;
  }
}

function normalizeLabelOptions(labelOps) {
  const list = Array.isArray(labelOps) ? labelOps : [labelOps];
  return list.map((item) => {
    if (!item?.labelId) throw new Error('labelId wajib diisi.');
    const type = item.type === 'remove' ? 'remove' : 'add';
    return { labelId: String(item.labelId), type };
  });
}

async function requestPhoneNumber(client, chatId, storeWaId = 'default') {
  const page = await getReadyPage(client, storeWaId);
  return page.evaluate((id) => {
    if (!window.WPP?.chat?.requestPhoneNumber) {
      throw new Error('WPP.chat.requestPhoneNumber tidak tersedia.');
    }
    return window.WPP.chat.requestPhoneNumber(id);
  }, chatId);
}

async function getPnLidEntry(client, chatId, storeWaId = 'default') {
  const page = await getReadyPage(client, storeWaId);
  return page.evaluate(async (id) => {
    if (!window.WPP?.contact?.getPnLidEntry) {
      throw new Error('WPP.contact.getPnLidEntry tidak tersedia.');
    }
    const entry = await window.WPP.contact.getPnLidEntry(id);
    const cleanWid = (wid) => {
      if (!wid) return null;
      if (typeof wid === 'string') return { serialized: wid, user: wid.split('@')[0] };
      const serialized = wid._serialized || wid.serialized || wid.id?._serialized || wid.id || '';
      return {
        serialized,
        user: wid.user || wid.id?.user || String(serialized || '').split('@')[0] || '',
        server: wid.server || wid.id?.server || String(serialized || '').split('@')[1] || ''
      };
    };
    return {
      phoneNumber: cleanWid(entry?.phoneNumber),
      lid: cleanWid(entry?.lid),
      contact: entry?.contact ? {
        name: entry.contact.name || '',
        pushname: entry.contact.pushname || '',
        shortName: entry.contact.shortName || '',
        verifiedName: entry.contact.verifiedName || '',
        isBusiness: Boolean(entry.contact.isBusiness),
        isEnterprise: Boolean(entry.contact.isEnterprise)
      } : null
    };
  }, chatId);
}

async function resolvePhoneForChatId(client, chatId, storeWaId = 'default') {
  const entry = await getPnLidEntry(client, chatId, storeWaId);
  const phoneWid = normalizeWidPayload(entry?.phoneNumber);
  const phone = String(phoneWid?.user || '').replace(/[^\d]/g, '');
  return {
    phone,
    phoneWid: phoneWid?.serialized || (phone ? `${phone}@c.us` : ''),
    lid: normalizeWidPayload(entry?.lid),
    contact: entry?.contact || null,
    source: phone ? 'wajs-pn-lid-cache' : 'wajs-pn-lid-cache-miss'
  };
}

async function markIsComposing(client, chatId, duration = 6000, storeWaId = 'default') {
  const page = await getReadyPage(client, storeWaId);
  return page.evaluate(({ id, ms }) => {
    if (!window.WPP?.chat?.markIsComposing) {
      throw new Error('WPP.chat.markIsComposing tidak tersedia.');
    }
    return window.WPP.chat.markIsComposing(id, ms);
  }, { id: chatId, ms: duration });
}

async function safeMarkIsComposing(client, chatId, duration, storeWaId = 'default') {
  try {
    if (!client?.__wajsReady && !await hasReadyWajs(client)) return false;
    await markIsComposing(client, chatId, duration, storeWaId);
    return true;
  } catch (_) {
    return false;
  }
}

async function markIsRead(client, chatId, storeWaId = 'default') {
  const page = await getReadyPage(client, storeWaId);
  return page.evaluate((id) => {
    if (!window.WPP?.chat?.markIsRead) {
      throw new Error('WPP.chat.markIsRead tidak tersedia.');
    }
    return window.WPP.chat.markIsRead(id);
  }, chatId);
}

async function safeMarkIsRead(client, chatId, storeWaId = 'default') {
  try {
    if (!client?.__wajsReady && !await hasReadyWajs(client)) return false;
    await markIsRead(client, chatId, storeWaId);
    return true;
  } catch (_) {
    return false;
  }
}

async function getLabels(client, storeWaId = 'default') {
  const page = await getReadyPage(client, storeWaId);
  return page.evaluate(async () => {
    if (!window.WPP?.labels?.getAllLabels) {
      throw new Error('WPP.labels.getAllLabels tidak tersedia.');
    }
    const labels = await window.WPP.labels.getAllLabels();
    return (labels || []).map(label => ({
      id: String(label.id),
      name: label.name,
      color: label.color ?? null,
      colorIndex: label.colorIndex ?? null,
      hexColor: label.hexColor || null,
      count: label.count || 0
    }));
  });
}

async function createLabel(client, name, color, storeWaId = 'default') {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Nama label wajib diisi.');

  const page = await getReadyPage(client, storeWaId);
  return page.evaluate(async ({ labelName, labelColor }) => {
    if (!window.WPP?.labels?.addNewLabel) {
      throw new Error('WPP.labels.addNewLabel tidak tersedia.');
    }
    const options = {};
    if (labelColor !== undefined && labelColor !== null && labelColor !== '') {
      options.labelColor = labelColor;
    }
    const label = await window.WPP.labels.addNewLabel(labelName, options);
    return label ? {
      id: String(label.id),
      name: label.name,
      color: label.color ?? null,
      colorIndex: label.colorIndex ?? null,
      hexColor: label.hexColor || null,
      count: label.count || 0
    } : null;
  }, {
    labelName: cleanName,
    labelColor: typeof color === 'number' ? color : (String(color || '').trim() || undefined)
  });
}

async function editLabel(client, labelId, updates = {}, storeWaId = 'default') {
  const cleanId = String(labelId || '').trim();
  if (!cleanId) throw new Error('labelId wajib diisi.');

  const page = await getReadyPage(client, storeWaId);
  return page.evaluate(async ({ id, labelName, labelColor }) => {
    if (!window.WPP?.labels?.editLabel) {
      throw new Error('WPP.labels.editLabel tidak tersedia.');
    }
    const options = {};
    if (labelName) options.name = labelName;
    if (labelColor !== undefined && labelColor !== null && labelColor !== '') {
      options.labelColor = labelColor;
    }
    return window.WPP.labels.editLabel(id, options);
  }, {
    id: cleanId,
    labelName: String(updates.name || '').trim() || undefined,
    labelColor: typeof updates.color === 'number' ? updates.color : (String(updates.color || '').trim() || undefined)
  });
}

async function deleteLabel(client, labelId, storeWaId = 'default') {
  const cleanId = String(labelId || '').trim();
  if (!cleanId) throw new Error('labelId wajib diisi.');

  const page = await getReadyPage(client, storeWaId);
  return page.evaluate((id) => {
    if (!window.WPP?.labels?.deleteLabel) {
      throw new Error('WPP.labels.deleteLabel tidak tersedia.');
    }
    return window.WPP.labels.deleteLabel(id);
  }, cleanId);
}

async function getLabelColorPalette(client, storeWaId = 'default') {
  const page = await getReadyPage(client, storeWaId);
  return page.evaluate(() => {
    if (!window.WPP?.labels?.getLabelColorPalette) {
      throw new Error('WPP.labels.getLabelColorPalette tidak tersedia.');
    }
    return window.WPP.labels.getLabelColorPalette();
  });
}

async function getChatLabels(client, chatId, storeWaId = 'default') {
  const cleanId = String(chatId || '').trim();
  if (!cleanId) return [];

  const page = await getReadyPage(client, storeWaId);
  return page.evaluate(async (id) => {
    const mapLabel = (label) => ({
      id: String(label.id),
      name: label.name,
      color: label.color ?? null,
      colorIndex: label.colorIndex ?? null,
      hexColor: label.hexColor || null,
    });

    if (window.WPP?.labels?.getLabelsForModel) {
      try {
        const labels = await window.WPP.labels.getLabelsForModel(id);
        return (labels || []).map(mapLabel);
      } catch (_) { /* fallback below */ }
    }

    const chat = window.WPP?.chat?.get?.(id)
      || window.Store?.Chat?.get?.(id);
    if (!chat) return [];

    const labelIds = chat.labels || chat.labelIds || [];
    if (!labelIds.length) return [];

    const allLabels = window.WPP?.labels?.getAllLabels
      ? await window.WPP.labels.getAllLabels()
      : [];
    const idSet = new Set(labelIds.map(String));
    return (allLabels || [])
      .filter((l) => idSet.has(String(l.id)))
      .map(mapLabel);
  }, cleanId);
}

async function addOrRemoveLabels(client, chatIds, labelOps, storeWaId = 'default') {
  const ids = Array.isArray(chatIds) ? chatIds : [chatIds];
  const cleanIds = ids.map(id => String(id || '').trim()).filter(Boolean);
  if (cleanIds.length === 0) throw new Error('Minimal satu contactId wajib diisi.');

  const options = normalizeLabelOptions(labelOps);
  const page = await getReadyPage(client, storeWaId);
  return page.evaluate(({ targetChatIds, labelOptions }) => {
    if (!window.WPP?.labels?.addOrRemoveLabels) {
      throw new Error('WPP.labels.addOrRemoveLabels tidak tersedia.');
    }
    return window.WPP.labels.addOrRemoveLabels(targetChatIds, labelOptions);
  }, { targetChatIds: cleanIds, labelOptions: options });
}

async function ensureLabel(client, name, color, storeWaId = 'default') {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('Nama label wajib diisi.');

  const labels = await getLabels(client, storeWaId);
  const existing = labels.find(label => String(label.name || '').toLowerCase() === cleanName.toLowerCase());
  if (existing) return existing;
  return createLabel(client, cleanName, color, storeWaId);
}

async function addLabelByName(client, chatIds, name, color, storeWaId = 'default') {
  const label = await ensureLabel(client, name, color, storeWaId);
  await addOrRemoveLabels(client, chatIds, [{ labelId: label.id, type: 'add' }], storeWaId);
  return label;
}

async function safeAddLabelByName(client, chatIds, name, color, storeWaId = 'default') {
  try {
    return await addLabelByName(client, chatIds, name, color, storeWaId);
  } catch (error) {
    logger.warn(`[${storeWaId}] Auto-label WA-JS dilewati: ${error.message}`);
    return null;
  }
}

async function sendReactionById(client, messageId, emoji, storeWaId = 'default') {
  const cleanMessageId = String(messageId || '').trim();
  if (!cleanMessageId) throw new Error('messageId wajib diisi.');
  const reaction = emoji === false || emoji === null || emoji === '' ? false : String(emoji || '\uD83D\uDC4D');

  const page = await getReadyPage(client, storeWaId);
  return page.evaluate(({ id, reactionText }) => {
    if (!window.WPP?.chat?.sendReactionToMessage) {
      throw new Error('WPP.chat.sendReactionToMessage tidak tersedia.');
    }
    return window.WPP.chat.sendReactionToMessage(id, reactionText);
  }, { id: cleanMessageId, reactionText: reaction });
}

async function forwardMessages(client, toChatId, messageIds, options = {}, storeWaId = 'default') {
  const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
  const cleanIds = ids.map(id => String(id || '').trim()).filter(Boolean);
  if (!cleanIds.length) throw new Error('Minimal satu messageId wajib diisi.');

  const page = await getReadyPage(client, storeWaId);
  return page.evaluate(({ to, idsToForward, forwardOptions }) => {
    if (window.WPP?.chat?.forwardMessages) {
      return window.WPP.chat.forwardMessages(to, idsToForward, forwardOptions || {});
    }
    if (window.WPP?.chat?.forwardMessage && idsToForward.length === 1) {
      return window.WPP.chat.forwardMessage(to, idsToForward[0], forwardOptions || {});
    }
    throw new Error('WPP.chat.forwardMessages tidak tersedia.');
  }, { to: toChatId, idsToForward: cleanIds, forwardOptions: options || {} });
}

/**
 * Mendapatkan daftar chat aktif via WPPConnect.
 * @param {object} client WWebJS Client
 * @param {string} storeWaId Store identifier
 * @returns {Array} List of chat objects
 */
async function getChats(client, storeWaId = 'default') {
  const page = await getReadyPage(client, storeWaId);
  const rawChats = await page.evaluate(async () => {
    if (!window.WPP?.chat?.list && !window.WPP?.chat?.getChats) {
      throw new Error('WPP.chat.list/getChats tidak tersedia.');
    }
    const chats = window.WPP.chat.list
      ? await window.WPP.chat.list({ count: 50, onlyUsers: true, ignoreGroupMetadata: true })
      : await window.WPP.chat.getChats();

    const safeGet = (fn, fallback = null) => {
      try {
        const value = fn();
        return value === undefined ? fallback : value;
      } catch (_) {
        return fallback;
      }
    };
    const getWaId = (idObj) => {
      if (!idObj) return '';
      if (typeof idObj === 'string') return idObj;
      if (idObj._serialized) return idObj._serialized;
      if (idObj.id?._serialized) return idObj.id._serialized;
      if (idObj.user && idObj.server) return `${idObj.user}@${idObj.server}`;
      return String(idObj);
    };

    // Petakan properti WPP ke WWebJS style
    return (chats || []).map(chat => ({
      id: { _serialized: getWaId(safeGet(() => chat.id)) || null },
      name: safeGet(() => chat.name) || safeGet(() => chat.formattedTitle) || '',
      isGroup: Boolean(safeGet(() => chat.isGroup, false)),
      unreadCount: Number(safeGet(() => chat.unreadCount, 0) || 0),
      timestamp: Number(safeGet(() => chat.t, 0) || 0),
      pin: safeGet(() => chat.pin, 0) || 0,
      archived: Boolean(safeGet(() => chat.archive, false)),
      isReadOnly: Boolean(safeGet(() => chat.isReadOnly, false))
    }));
  });

  // Tambahkan mock methods yang sering dipanggil oleh WWebJS logic
  return rawChats.map(chat => ({
    ...chat,
    sendSeen: async () => safeMarkIsRead(client, chat.id._serialized, storeWaId)
  }));
}

/**
 * Mengambil pesan-pesan terakhir dalam suatu chat via WPPConnect.
 * Berguna karena WWebJS fetchMessages sering crash karena 'waitForChatLoading'.
 * @param {object} client WWebJS Client
 * @param {string} chatId Target chat ID
 * @param {number} limit Maksimal pesan yang ditarik
 * @param {string} storeWaId Store identifier
 * @returns {Array} List of message objects
 */
async function getMessages(client, chatId, limit = 20, storeWaId = 'default') {
  const cleanChatId = String(chatId || '').trim();
  if (!cleanChatId) throw new Error('chatId wajib diisi.');

  const page = await getReadyPage(client, storeWaId);
  const rawMessages = await page.evaluate(async ({ id, count }) => {
    if (!window.WPP?.chat?.getMessages) {
      throw new Error('WPP.chat.getMessages tidak tersedia.');
    }
    const msgs = await window.WPP.chat.getMessages(id, { count });
    
    // Helper internal untuk stringify _serialized jika object
    const getWaId = (idObj) => {
      if (!idObj) return '';
      if (typeof idObj === 'string') return idObj;
      if (idObj._serialized) return idObj._serialized;
      if (idObj.id?._serialized) return idObj.id._serialized;
      if (idObj.user && idObj.server) return `${idObj.user}@${idObj.server}`;
      return String(idObj);
    };
    const getMsgId = (idObj) => {
      if (!idObj) return '';
      if (typeof idObj === 'string') return idObj;
      if (idObj._serialized) return idObj._serialized;
      if (typeof idObj.id === 'string') return idObj.id;
      if (idObj.id?._serialized) return idObj.id._serialized;
      if (idObj.remote && idObj.id) return `${idObj.fromMe ? 'true' : 'false'}_${getWaId(idObj.remote)}_${idObj.id}`;
      return String(idObj);
    };
    const safeGet = (fn, fallback = null) => {
      try {
        const value = fn();
        return value === undefined ? fallback : value;
      } catch (_) {
        return fallback;
      }
    };

    // Petakan properti WPP ke WWebJS style untuk message_handler compatibility
    return (msgs || []).map(msg => ({
      ...(() => {
        const quoted = safeGet(() => msg.quotedMsg, null) ||
          safeGet(() => (typeof msg.quotedMsgObj === 'function' ? msg.quotedMsgObj() : null), null);
        const quotedId = getMsgId(
          safeGet(() => msg.quotedMsgId, null) ||
          safeGet(() => msg.quotedMsgKey, null) ||
          safeGet(() => quoted?.id, null)
        ) || safeGet(() => msg.quotedStanzaID, '') || '';
        return {
          hasQuotedMsg: Boolean(quotedId || quoted),
          quotedMsgId: quotedId,
          quotedBody: safeGet(() => quoted?.body, '') || safeGet(() => quoted?.caption, '') || '',
          quotedFromMe: Boolean(safeGet(() => quoted?.id?.fromMe, false) || safeGet(() => quoted?.fromMe, false)),
          quotedSenderName: safeGet(() => quoted?.pushName, '') || ''
        };
      })(),
      id: { _serialized: getMsgId(safeGet(() => msg.id, null)) || null },
      from: getWaId(safeGet(() => msg.from, null)),
      to: getWaId(safeGet(() => msg.to, null)),
      body: safeGet(() => msg.body, '') || '',
      isStatus: Boolean(safeGet(() => msg.isStatusV3, false)),
      fromMe: Boolean(safeGet(() => msg.id?.fromMe, false) || safeGet(() => msg.fromMe, false)),
      timestamp: safeGet(() => msg.t, 0) || 0,
      hasMedia: Boolean(safeGet(() => msg.hasMedia, false) || safeGet(() => msg.isMedia, false) || safeGet(() => msg.mediaData, null)),
      type: safeGet(() => msg.type, 'chat') || 'chat',
      author: getWaId(safeGet(() => msg.author, null)) || undefined,
      vCards: safeGet(() => msg.vCards, []) || [],
      // properti tambahan untuk keperluan spesifik WWebJS
      ack: safeGet(() => msg.ack, 0) || 0,
      deviceType: safeGet(() => msg.deviceType, 'web') || 'web'
    }));
  }, { id: cleanChatId, count: limit });

  // Tambahkan util methods
  return rawMessages.map(msg => ({
    ...msg,
    client: client, // penting untuk downloadMedia jika ada
    getContact: async () => {
      // Ambil basic info dari object message atau fallback
      return {
        name: msg.author || msg.from,
        pushname: '',
        shortName: '',
        displayName: msg.author || msg.from,
        number: String(msg.from).split('@')[0]
      };
    }
  }));
}

module.exports = {
  injectWajs,
  getClientWajsStatus,
  safeSendReactionToMessage,
  requestPhoneNumber,
  getPnLidEntry,
  resolvePhoneForChatId,
  markIsComposing,
  safeMarkIsComposing,
  safeMarkIsRead,
  markIsRead,
  getLabels,
  getChatLabels,
  createLabel,
  editLabel,
  deleteLabel,
  getLabelColorPalette,
  addOrRemoveLabels,
  ensureLabel,
  addLabelByName,
  safeAddLabelByName,
  sendReactionById,
  forwardMessages,
  getChats,
  getMessages
};
