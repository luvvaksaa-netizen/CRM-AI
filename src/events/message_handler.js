const logger = require('../utils/logger');
const { getAIResponse, calculateTypingDelay, RESPONSE_TYPE } = require('../ai_service');
const { Store, ChatMessage } = require('../database/index');
const { analyzeImage } = require('../services/vision_service');
const dashboard = require('../services/dashboard_service');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { MessageMedia } = require('whatsapp-web.js');
const { UPLOADS_DIR } = require('../config');

function formatWaNumber(id) {
    if (!id) return '';
    let num = id.split('@')[0];
    if (num.startsWith('62')) return `+62 ${num.slice(2, 5)}-${num.slice(5, 9)}-${num.slice(9)}`;
    return `+${num}`;
}

/**
 * Handle incoming message event with Multi-Session + Smart Media (Phase 4).
 * @param {object} message  - WhatsApp message object
 * @param {string} storeWaId - ID Session Toko (Context Aware)
 */
async function handleMessage(message, storeWaId) {
    if (message.isStatus || message.from.includes('@g.us')) return;

    const contactId = message.from;
    const body = message.body || "";
    let customerMediaContext = "";
    let tempPath = "";

    try {
        // === 1. CEK & ANALISIS MEDIA DARI PELANGGAN (AI Mata) ===
        if (message.hasMedia) {
            const media = await message.downloadMedia();
            if (media && media.mimetype.startsWith('image/')) {
                logger.info(`[${storeWaId}] Menerima foto dari pelanggan. Menganalisis...`);
                
                // Simpan MASA PERMANEN ke UPLOADS_DIR agar bisa dilihat di Dashboard Web CRM
                const fileName = `customer_${storeWaId}_${Date.now()}.${media.mimetype.split('/')[1]}`;
                tempPath = path.join(UPLOADS_DIR, fileName);
                fs.writeFileSync(tempPath, Buffer.from(media.data, 'base64'));

                // Ambil store & agent context untuk panduan AI Vision
                const { BotAgent } = require('../database/index');
                const store = await Store.findOne({ 
                    where: { wa_id: storeWaId },
                    include: [{ model: BotAgent, as: 'BotAgent' }]
                });
                const agent = store?.BotAgent;

                const contextParts = [];
                if (store) contextParts.push(`Nama Toko: ${store.name}`);
                if (agent) {
                    contextParts.push(`Nama Agen: ${agent.bot_name}`);
                    contextParts.push(`Pengetahuan: ${agent.product_knowledge}`);
                }
                const storeContext = contextParts.join('\n');

                customerMediaContext = await analyzeImage(tempPath, storeContext);
                logger.success(`[${storeWaId}] AI "melihat" foto pelanggan: ${customerMediaContext.substring(0, 50)}...`);
                
                // Beri tag khusus agar UI bisa menampilkan gambar
                customerMediaContext = `[MEDIA:/uploads/${fileName}] ${customerMediaContext}`;
            }
        }

        // 2. Log Pesan Pelanggan ke DB & Dashboard UI (Sertakan tag gambar dari customerMediaContext)
        const logBody = customerMediaContext 
            ? `${customerMediaContext}\n${body}`.trim()
            : body;

        const contact = await message.getContact();
        const senderName = contact.name || contact.pushname || contact.shortName || formatWaNumber(contactId);

        await dashboard.addToChatHistory(storeWaId, {
            from: contactId,
            body: logBody,
            isMe: false,
            timestamp: new Date(),
            sender_name: senderName
        });

        logger.info(`[${storeWaId}] Pesan Masuk [${contactId}]: ${body}`);

        // 3. Ambil Konfigurasi Bot & Agen dari DB
        const { BotAgent } = require('../database/index');
        const store = await Store.findOne({ 
            where: { wa_id: storeWaId },
            include: [{ model: BotAgent, as: 'BotAgent' }]
        });
        const agent = store?.BotAgent;

        // JIKA STORE TIDAK ADA atau BOT OFF: Berhenti
        if (!store || store.is_bot_active === false) {
            logger.info(`[${storeWaId}] Bot OFF atau Perangkat tidak ditemukan.`);
            return;
        }

        // JIKA BELUM ADA AGEN TERPASANG: Berhenti
        if (!agent) {
            logger.warn(`[${storeWaId}] Perangkat ini belum terikat ke Agen AI manapun.`);
            return;
        }

        const chat = await message.getChat();

        // 3. Ambil Riwayat Chat dari DB (konteks percakapan)
        const recentHistory = await ChatMessage.findAll({
            where: { contact_id: contactId, store_wa_id: storeWaId },
            limit: 10,
            order: [['timestamp', 'DESC']]
        });
        const history = recentHistory.reverse();

        // 3.5 === MARKETING AUTOPILOT (Trigger Keyword Check - Via Agent) ===
        const { MediaAsset } = require('../database/index');
        const agentAssets = await MediaAsset.findAll({ where: { agent_id: agent.id } });
        let triggeredAsset = null;

        for (const asset of agentAssets) {
            if (!asset.trigger_words) continue;
            const keywords = asset.trigger_words.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
            const bodyLower = body.toLowerCase();
            
            if (keywords.some(kw => bodyLower.includes(kw))) {
                triggeredAsset = asset;
                break;
            }
        }

        if (triggeredAsset) {
            logger.success(`[${storeWaId}] Keyword trigger [${agent.name}] aktif. Mengirim Katalog via Autopilot!`);
            await chat.sendStateTyping();
            await new Promise(r => setTimeout(r, 1200)); 
            
            const caption = triggeredAsset.description || triggeredAsset.label;
            await _sendMediaToChat(message, triggeredAsset, caption, storeWaId, contactId, agent);
            return; 
        }

        // 4. Jeda Berpikir (Natural Feel)
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 700) + 500));

        // 5. Status Mengetik
        await chat.sendStateTyping();

        // 6. === PHASE 4: PROSES AI (Text + Smart Media + Visual Perception + Agent Awareness) ===
        const aiResult = await getAIResponse(body, history, store, agent, customerMediaContext);

        // 7. Jeda Mengetik (Natural Feel)
        const typingDelay = calculateTypingDelay(aiResult.content);
        await new Promise(r => setTimeout(r, typingDelay));

        // 8. === KIRIM RESPONS (Teks atau Media) ===
        if (aiResult.type === RESPONSE_TYPE.MEDIA && aiResult.mediaList && aiResult.mediaList.length > 0) {
            // --- MODE MULTI-MEDIA: Kirim satu per satu ---
            for (let i = 0; i < aiResult.mediaList.length; i++) {
                const item = aiResult.mediaList[i];
                await _sendMediaToChat(message, item.media, item.caption || "", storeWaId, contactId, agent);
                
                if (i < aiResult.mediaList.length - 1) {
                    await new Promise(r => setTimeout(r, 1500));
                }
            }

            if (aiResult.content) {
                await message.reply(aiResult.content);
                await _logBotReply(storeWaId, contactId, aiResult.content, agent.bot_name);
            }
        } else {
            // --- MODE TEKS: Kirim Pesan Biasa ---
            await message.reply(aiResult.content);
            await _logBotReply(storeWaId, contactId, aiResult.content, agent.bot_name);
        }

        logger.success(`[${storeWaId}] Sesi [${contactId}] — Dibalas via AI dengan persepsi visual.`);

    } catch (error) {
        logger.error(`[${storeWaId}] Gagal memproses [${contactId}]: ${error.message}`);
    } finally {
        // tempPath sekarang disimpan permanen untuk Dashboard CRM,
        // KECUALI jika tempPath menggunakan os.tmpdir() (misal format yg tidak didukung)
        if (tempPath && tempPath.includes(os.tmpdir()) && fs.existsSync(tempPath)) {
            try {
                fs.unlinkSync(tempPath);
                logger.info(`[${storeWaId}] File sementara dibersihkan.`);
            } catch (e) { /* ignore */ }
        }
    }
}

/**
 * Mengirimkan file media (foto/video) ke chat WhatsApp.
 * @private
 * @param {object} message
 * @param {object} mediaAsset
 * @param {string} caption
 * @param {string} storeWaId
 * @param {string} contactId
 * @param {object} agent - Object agen pemilik media
 */
async function _sendMediaToChat(message, mediaAsset, caption, storeWaId, contactId, agent) {
    const { UPLOADS_DIR } = require('../config');
    const mediaPath = path.join(UPLOADS_DIR, mediaAsset.filename);
    
    try {
        if (!fs.existsSync(mediaPath)) throw new Error(`File tidak ditemukan: ${mediaAsset.filename}`);

        const mediaMsg = MessageMedia.fromFilePath(mediaPath);
        await message.reply(mediaMsg, undefined, { caption: caption || "" });

        // Log media ke chat history, tampilkan Thumbnail di Dashboard Web
        const fileExt = mediaPath.split('.').pop().toLowerCase();
        const tag = ['mp4', 'mov', 'avi'].includes(fileExt) ? '[VIDEO' : '[MEDIA';
        
        const logBody = `${tag}:/uploads/${mediaAsset.filename}] ${caption || `Katalog: ${mediaAsset.label}`}`;
        await _logBotReply(storeWaId, contactId, logBody, agent?.bot_name);
        
        logger.success(`[${storeWaId}] Media [${mediaAsset.label}] dikirim ke [${contactId}]`);
    } catch (mediaError) {
        logger.error(`[${storeWaId}] Gagal kirim media: ${mediaError.message}`);
        await message.reply(`Gagal mengirim media "${mediaAsset.label}".`);
    }
}

/**
 * Helper: Simpan balasan bot ke DB & Dashboard UI.
 * @private
 */
async function _logBotReply(storeWaId, contactId, body, botName) {
    await dashboard.addToChatHistory(storeWaId, {
        from: contactId,
        body: body,
        isMe: true,
        timestamp: new Date(),
        sender_name: botName || 'AI Assistant'
    });
}

module.exports = { handleMessage };
