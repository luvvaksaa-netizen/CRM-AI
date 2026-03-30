const logger = require('../utils/logger');
const { getAIResponse, calculateTypingDelay, RESPONSE_TYPE } = require('../ai_service');
const { Store, ChatMessage } = require('../database/index');
const { analyzeImage } = require('../services/vision_service');
const dashboard = require('../services/dashboard_service');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { MessageMedia } = require('whatsapp-web.js');

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
                
                // Simpan sementara untuk dianalisis
                const fileName = `customer_${Date.now()}.${media.mimetype.split('/')[1]}`;
                tempPath = path.join(os.tmpdir(), fileName);
                fs.writeFileSync(tempPath, Buffer.from(media.data, 'base64'));

                // Ambil store context untuk panduan AI Vision
                const store = await Store.findOne({ where: { wa_id: storeWaId } });
                const storeContext = store 
                    ? `Nama Toko: ${store.name}\nPengetahuan Produk: ${store.product_knowledge}`
                    : "";

                customerMediaContext = await analyzeImage(tempPath, storeContext);
                logger.success(`[${storeWaId}] AI "melihat" foto pelanggan: ${customerMediaContext.substring(0, 50)}...`);
            }
        }

        // 2. Log Pesan Pelanggan ke DB & Dashboard UI (Sertakan label foto jika ada)
        const logBody = customerMediaContext 
            ? `[🖼️ Foto: ${customerMediaContext}]\n${body}`.trim()
            : body;

        await dashboard.addToChatHistory(storeWaId, {
            from: contactId,
            body: logBody,
            isMe: false,
            timestamp: new Date(),
            sender_name: message._data?.notifyName || contactId
        });

        logger.info(`[${storeWaId}] Pesan Masuk [${contactId}]: ${body}`);

        // 3. Ambil Konfigurasi Bot dari DB
        const store = await Store.findOne({ where: { wa_id: storeWaId } });

        // JIKA BOT OFF: Log saja, lalu berhenti
        if (store && store.is_bot_active === false) {
            logger.info(`[${storeWaId}] Bot OFF. Pesan [${contactId}] tercatat untuk CS manual.`);
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

        // 4. Jeda Berpikir (Natural Feel)
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 700) + 500));

        // 5. Status Mengetik
        await chat.sendStateTyping();

        // 6. === PHASE 4: PROSES AI (Text + Smart Media + Visual Perception) ===
        const aiResult = await getAIResponse(body, history, store, customerMediaContext);

        // 7. Jeda Mengetik (Natural Feel)
        const typingDelay = calculateTypingDelay(aiResult.content);
        await new Promise(r => setTimeout(r, typingDelay));

        // 8. === KIRIM RESPONS (Teks atau Media) ===
        if (aiResult.type === RESPONSE_TYPE.MEDIA && aiResult.mediaList && aiResult.mediaList.length > 0) {
            // --- MODE MULTI-MEDIA: Kirim satu per satu ---
            for (let i = 0; i < aiResult.mediaList.length; i++) {
                const item = aiResult.mediaList[i];
                await _sendMediaToChat(message, item.media, item.caption || "", storeWaId, contactId, store);
                
                if (i < aiResult.mediaList.length - 1) {
                    await new Promise(r => setTimeout(r, 1500));
                }
            }

            if (aiResult.content) {
                await message.reply(aiResult.content);
                await _logBotReply(storeWaId, contactId, aiResult.content, store?.bot_name);
            }
        } else {
            // --- MODE TEKS: Kirim Pesan Biasa ---
            await message.reply(aiResult.content);
            await _logBotReply(storeWaId, contactId, aiResult.content, store?.bot_name);
        }

        logger.success(`[${storeWaId}] Sesi [${contactId}] — Dibalas via AI dengan persepsi visual.`);

    } catch (error) {
        logger.error(`[${storeWaId}] Gagal memproses [${contactId}]: ${error.message}`);
    } finally {
        // Hapus file temp jika ada
        if (tempPath && fs.existsSync(tempPath)) {
            try {
                fs.unlinkSync(tempPath);
                logger.info(`[${storeWaId}] File sementara pelanggan dibersihkan.`);
            } catch (e) { /* ignore */ }
        }
    }
}

/**
 * Mengirimkan file media (foto/video) ke chat WhatsApp.
 * @private
 */
async function _sendMediaToChat(message, mediaAsset, caption, storeWaId, contactId, store) {
    const mediaPath = path.join(process.cwd(), 'public', 'uploads', mediaAsset.filename);
    
    try {
        if (!fs.existsSync(mediaPath)) throw new Error(`File tidak ditemukan: ${mediaAsset.filename}`);

        const mediaMsg = MessageMedia.fromFilePath(mediaPath);
        await message.reply(mediaMsg, undefined, { caption: caption || "" });

        // Log media ke chat history
        const logBody = `[📸 Media: ${mediaAsset.label}] ${caption}`;
        await _logBotReply(storeWaId, contactId, logBody, store?.bot_name);
        
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
