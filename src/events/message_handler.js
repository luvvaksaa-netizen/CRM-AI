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

// === IN-MEMORY PAUSE REGISTRY (Human Override) ===
// Menyimpan status pause untuk kontak tertentu agar bot tidak membalas
const pausedContacts = new Set(); // Key: 'storeWaId_contactId'

function pauseBotForContact(storeWaId, contactId) {
    pausedContacts.add(`${storeWaId}_${contactId}`);
    logger.info(`[${storeWaId}] Bot DIPAUSE secara manual untuk kontak: ${contactId}`);
}

function resumeBotForContact(storeWaId, contactId) {
    pausedContacts.delete(`${storeWaId}_${contactId}`);
    logger.info(`[${storeWaId}] Bot DIAKTIFKAN KEMBALI untuk kontak: ${contactId}`);
}

/**
 * Handle incoming message event with Multi-Session + Smart Media (Phase 4).
 * @param {object} message  - WhatsApp message object
 * @param {string} storeWaId - ID Session Toko (Context Aware)
 * @param {boolean} shouldAIReply - Jika true, AI akan memproses balasan. Jika false, hanya catat ke DB.
 */
async function handleMessage(message, storeWaId, shouldAIReply = true) {
    if (message.isStatus || message.from.includes('@g.us')) return;

    const contactId = message.from;
    const body = message.body || "";
    let customerMediaContext = "";
    let tempPath = "";

    try {
        // === 1. CEK & ANALISIS MEDIA DARI PELANGGAN (AI Mata & Telinga) ===
        if (message.hasMedia) {
            const media = await message.downloadMedia();
            if (!media) throw new Error("Gagal mengunduh media dari pesan.");

            // A. FOTO (Vision)
            if (media.mimetype.startsWith('image/')) {
                logger.info(`[${storeWaId}] Menerima foto dari pelanggan. Menganalisis...`);
                const fileName = `customer_${storeWaId}_${Date.now()}.${media.mimetype.split('/')[1]}`;
                tempPath = path.join(UPLOADS_DIR, fileName);
                fs.writeFileSync(tempPath, Buffer.from(media.data, 'base64'));

                const { BotAgent } = require('../database/index');
                const store = await Store.findOne({ 
                    where: { wa_id: storeWaId },
                    include: [{ model: BotAgent, as: 'BotAgent' }]
                });
                const agent = store?.BotAgent;

                const storeContext = `Nama Toko: ${store?.name || 'Toko'}\nKonten Agen: ${agent?.product_knowledge || ''}`;
                const analysis = await analyzeImage(tempPath, storeContext);
                
                logger.success(`[${storeWaId}] AI "melihat" foto pelanggan.`);
                // Gunakan format khusus untuk AI Insight agar diproses dashboard
                customerMediaContext = `[MEDIA:/uploads/${fileName}]\n\n[AI-VISION: ${analysis}]`;
            }

            // B. VOICE NOTE (Transcription)
            if (media.mimetype.startsWith('audio/')) {
                logger.info(`[${storeWaId}] Menerima Voice Note. Mendengarkan...`);
                // Whisper suka ogg/mp3/wav. WhatsApp biasanya ogg.
                const audioExt = media.mimetype.split('/')[1].split(';')[0] || 'ogg';
                const audioName = `voice_${storeWaId}_${Date.now()}.${audioExt}`;
                const audioPath = path.join(UPLOADS_DIR, audioName);
                fs.writeFileSync(audioPath, Buffer.from(media.data, 'base64'));

                const { transcribeAudio } = require('../ai_service');
                const transcription = await transcribeAudio(audioPath);

                if (transcription) {
                    logger.success(`[${storeWaId}] AI "mendengar" VN: ${transcription}`);
                    customerMediaContext = `[AI-TRANSKRIPSI: ${transcription}]`;
                }
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

        logger.info(`[${storeWaId}] Pesan masuk terdaftar: ${contactId}`);

        // === FIREWALL: CEK JALUR AUTO-REPLY (TAHAP 1) ===
        if (!shouldAIReply) {
            logger.info(`[${storeWaId}] Jalur Sinkronisasi: Pesan dicatat, AI Dilewati.`);
            return;
        }

        // === FIREWALL 2: HUMAN OVERRIDE (TAHAP 3) ===
        if (pausedContacts.has(`${storeWaId}_${contactId}`)) {
            logger.info(`[${storeWaId}] Bot sedang dipause (Diambil alih human) untuk: ${contactId}`);
            return; // Berhenti membalas kalau human lagi intervensi
        }

        // 3. Ambil Konfigurasi Bot & Agen dari DB
        const { BotAgent } = require('../database/index');
        const store = await Store.findOne({ 
            where: { wa_id: storeWaId },
            include: [{ model: BotAgent, as: 'BotAgent' }]
        });
        const agent = store?.BotAgent;

        // JIKA STORE TIDAK ADA atau BOT OFF: Berhenti
        if (!store || store.is_bot_active === false) {
            logger.info(`[${storeWaId}] Bot NON-AKTIF untuk Toko ini.`);
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
            limit: 20, // Diperbanyak agar ingatan lebih tajam
            order: [['timestamp', 'DESC']]
        });
        // Pastikan kita mengambil data mentah (plain) agar role-mapping lancar
        const history = recentHistory.map(h => h.get({ plain: true })).reverse();

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
            await message.reply(aiResult.content);
            await _logBotReply(storeWaId, contactId, aiResult.content, agent.bot_name);
        }

        logger.success(`[${storeWaId}] Sesi [${contactId}] — Dibalas via AI dengan persepsi visual.`);

        // TAHAP 4: Update Rekap Chat (Summary) secara background (Non-blocking)
        _updateConversationSummary(storeWaId, contactId, history); 


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

/**
 * TAHAP 4: Background Summary Updater
 * Menggunakan AI untuk merangkum percakapan agar admin bisa lihat progress per customer.
 */
async function _updateConversationSummary(storeWaId, contactId, history) {
    try {
        const { ChatSummary } = require('../database/index');
        const { generateChatSummary } = require('../ai_service');
        
        const summaryText = await generateChatSummary(history);
        
        // SQLite upsert in Sequelize often fails with composite keys.
        // We use manual find/create or update instead.
        const [summary, created] = await ChatSummary.findOrCreate({
            where: { store_wa_id: storeWaId, contact_id: contactId },
            defaults: { summary: summaryText, last_updated: new Date() }
        });

        if (!created) {
            summary.summary = summaryText;
            summary.last_updated = new Date();
            await summary.save();
        }
        
        logger.info(`[${storeWaId}] Rekap Chat Pelanggan [${contactId}] Berhasil Diperbarui.`);
    } catch (e) {
        logger.error(`Gagal update summary: ${e.message}`);
    }
}



module.exports = { 
    handleMessage,
    pauseBotForContact,
    resumeBotForContact,
    pausedContacts
};
