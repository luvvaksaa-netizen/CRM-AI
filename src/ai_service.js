/**
 * @file ai_service.js
 * @description AI Service dengan Knowledge-Aware Media Architecture.
 * Media bisa berfungsi sebagai:
 *  - Knowledge: AI "membaca" analisis/transkrip media untuk menjawab pertanyaan
 *  - Catalog: AI bisa mengirim file ke customer
 *  - Both: Keduanya sekaligus
 */

const OpenAI = require('openai');
const moment = require('moment');
const fs = require('fs');
const config = require('./config');
const { ERRORS } = require('./constants');
const logger = require('./utils/logger');
const rajaOngkir = require('./services/rajaongkir_service');
const { getSendableMedia, getKnowledgeMedia } = require('./services/media_service');
const { MediaAsset } = require('./database/index');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// === RESPONSE TYPE CONSTANTS ===
const RESPONSE_TYPE = {
    TEXT: 'text',
    MEDIA: 'media'
};

// === LIGHTWEIGHT CONCURRENCY LIMITER ===
// Membatasi agar AI hanya memproses 3 chat serentak (mencegah CPU Spike pada 2GB RAM).
let activeRequests = 0;
const MAX_CONCURRENCY = 3;
const pendingQueue = [];

function runNextInQueue() {
    if (activeRequests < MAX_CONCURRENCY && pendingQueue.length > 0) {
        const { resolve, execute } = pendingQueue.shift();
        activeRequests++;
        execute().then(res => {
            activeRequests--;
            resolve(res);
            runNextInQueue();
        });
    }
}

async function getAIResponse(userMessage, history = [], store = null, agent = null, customerMediaContext = "", conversationSummary = "", interactionCount = 1) {
    return new Promise((resolve) => {
        pendingQueue.push({
            resolve,
            execute: () => _processAIResponse(userMessage, history, store, agent, customerMediaContext, conversationSummary, interactionCount)
        });
        runNextInQueue();
    });
}

/**
 * Logika internal pemrosesan AI (Metode asli dipindah ke sini)
 */
async function _processAIResponse(userMessage, history = [], store = null, agent = null, customerMediaContext = "", conversationSummary = "", interactionCount = 1) {
    if (!config.OPENAI_API_KEY || config.OPENAI_API_KEY.includes('your_openai_api_key')) {
        logger.error("OpenAI API Key belum dikonfigurasi!");
        return { type: RESPONSE_TYPE.TEXT, content: ERRORS.AI_FALLBACK };
    }

    try {
        const sysPrompt = agent?.system_prompt || store?.system_prompt || 'Anda adalah admin CS yang ramah.';
        const knowledge = agent?.product_knowledge || store?.product_knowledge || 'Kami melayani pembuatan barang berkualitas.';
        const modelName = config.MODEL_NAME || 'gpt-4o-mini';
        const agentId   = agent?.id || null;

        // ── KNOWLEDGE MEDIA: Media yang jadi pengetahuan AI ──────────────────
        const knowledgeMedia = agentId ? await getKnowledgeMedia(agentId) : [];
        const knowledgeSection = knowledgeMedia.length > 0
            ? knowledgeMedia.map(m => {
                const icon = m.type === 'video' ? '🎬 VIDEO' : '📸 FOTO';
                const parts = [`[${icon}] "${m.label}"`];
                if (m.description)      parts.push(`  Deskripsi: ${m.description}`);
                if (m.ai_analysis)      parts.push(`  Analisis Visual: ${m.ai_analysis}`);
                if (m.video_transcript) parts.push(`  Isi Narasi dalam video: "${m.video_transcript}"`);
                return parts.join('\n');
              }).join('\n\n')
            : '(Belum ada media knowledge)';

        // ── SENDABLE CATALOG: Media yang bisa dikirim ke customer ────────────
        const sendableMedia = agentId ? await getSendableMedia(agentId) : [];
        const catalogSection = sendableMedia.length > 0
            ? sendableMedia.map(m =>
                `- ID: ${m.id} | Label: "${m.label}" | Tipe: ${m.type}`
              ).join('\n')
            : '(Tidak ada media yang bisa dikirim)';

        const fullSystemInstruction = `
${sysPrompt}

═══════════════════════════════════════════
INFORMASI SESI (STATISTIK):
═══════════════════════════════════════════
- Jumlah Interaksi: ${interactionCount}
- Pesan ini adalah interaksi ke-${interactionCount}.

═══════════════════════════════════════════
ATURAN UTAMA & LIMITASI HARGA (DRACONIAN):
═══════════════════════════════════════════
1. DILARANG menyebutkan/membahas harga (seperti 149k) jika interaksi < 3 (yaitu interaksi ke-1 dan ke-2). Gali kebutuhan desain dulu!
2. Mulai sebutkan harga HANYA pada interaksi ke-3 atau lebih, DAN WAJIB kirim 1-3 media katalog saat itu.
3. OPENING (Interaksi ke-1): WAJIB kirim 1 media katalog contoh awal.
4. JANGAN PERNAH menulis teks seperti "[FOTO] Nama" atau "[MEDIA:/uploads/...]" secara manual. Gunakan tool.
5. Kirimkan pertanyaan HANYA di gelembung (bubble) terakhir jika kamu membalas dengan beberapa baris.
6. JANGAN PERNAH berhalusinasi menyertakan link Markdown seperti "![Gambar](https://example.com/...)". Gunakan tool "kirim_media_katalog" jika ingin mengirim gambar.
7. Semua jawaban harus berupa teks biasa yang ramah, santai, dan komunikatif sesuai kepribadian Dini.
8. Dilarang keras menyebutkan link atau website fiktif (example.com).

═══════════════════════════════════════════
MEMORI / REKAP PERCAKAPAN (The Story So Far):
═══════════════════════════════════════════
Gunakan ini untuk mengenali status pelanggan:
${conversationSummary || 'Belum ada rekapan diskusi sebelumnya.'}

═══════════════════════════════════════════
INFORMASI PRODUK & KEUNGGULAN (KNOWLEDGE):
═══════════════════════════════════════════
${knowledge}

KETERSEDIAAN MEDIA:
- Kamu memiliki ${sendableMedia.length} item di katalog yang bisa dikirim.
- Kamu memiliki ${knowledgeMedia.length} item pengetahuan video/foto.

═══════════════════════════════════════════
PENGETAHUAN DARI MEDIA (Foto & Video):
═══════════════════════════════════════════
${knowledgeSection}

═══════════════════════════════════════════
KATALOG YANG BISA DIKIRIM KE PELANGGAN:
═══════════════════════════════════════════
Gunakan tool "kirim_media_katalog" dan masukkan ID media di bawah ini ke dalam ARRAY. 
${catalogSection}

═══════════════════════════════════════════
ATURAN STANDAR:
1. Jawab akurat dan ramah.
2. Gunakan tool "cek_ongkir_jne" jika pelanggan tanya ongkir.
3. Gunakan tool "kirim_media_katalog" HANYA jika pelanggan minta lihat foto/video. 
4. Kamu bisa mengirim beberapa ID sekaligus.
5. Jika pelanggan minta "semua katalog", masukkan semua ID katalog ke array media_ids.
6. PROTOKOL PEMBAYARAN: Jika mengklaim "Sudah Transfer", WAJIB minta FOTO BUKTI.

WAKTU SEKARANG: ${moment().format('dddd, DD MMMM YYYY, HH:mm')}
`.trim();

        // === TOOL DEFINITIONS ===
        const tools = [
            {
                type: "function",
                function: {
                    name: "cek_ongkir_jne",
                    description: "Mengecek biaya ongkos kirim JNE dari Kediri ke kota tujuan di Indonesia.",
                    parameters: {
                        type: "object",
                        properties: {
                            destinationCity: { type: "string", description: "Nama kota atau kabupaten tujuan." },
                            weightGrams: { type: "integer", description: "Berat paket dalam gram (default 1000)." }
                        },
                        required: ["destinationCity"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "kirim_media_katalog",
                    description: "Mengirimkan satu atau beberapa foto/video produk kepada pelanggan.",
                    parameters: {
                        type: "object",
                        properties: {
                            media_ids: { 
                                type: "array", 
                                items: { type: "integer" },
                                description: "Array ID media dari katalog yang ingin dikirimkan." 
                            },
                            caption: { type: "string", description: "Teks penjelasan singkat tentang media yang dikirim." }
                        },
                        required: ["media_ids"]
                    }
                }
            }
        ];

        // === BUILD MESSAGES ===
        let userContent = userMessage;
        if (customerMediaContext) {
            userContent = `[SISTEM: Pelanggan baru saja mengirim MEDIA/FOTO. Berikut adalah deskripsi visualnya untuk panduanmu: ${customerMediaContext}]\n\nPESAN PELANGGAN: ${userMessage || '(Hanya mengirim foto)'}`;
        }

        const filteredHistory = history.length > 0 
            ? history.slice(0, history.length - 1) 
            : [];

        let messages = [
            { role: "system", content: fullSystemInstruction },
            ...filteredHistory.map(h => {
                const dayStr = h.timestamp ? moment(h.timestamp).format('DD MMM HH:mm') : "";
                return {
                    role: h.is_from_me ? 'assistant' : 'user',
                    content: `[LOG-WAKTU: ${dayStr}]\n${h.body || h.content || ""}`
                };
            }),
            { 
                role: "system", 
                content: `--- INSTRUKSI PRIORITAS: Gunakan riwayat di atas untuk mengenali PELANGGAN (nama, konteks) dan melanjutkan topik yang sedang dibahas. Jangan mengulangi pertanyaan yang sudah terjawab di atas. Jangan sertakan tag [LOG-WAKTU] atau format log [MEDIA:...] dalam jawabanmu. ---` 
            },
            { role: "user", content: userContent }
        ];

        // === FIRST AI CALL ===
        const response = await openai.chat.completions.create({
            model: modelName,
            messages,
            tools,
            tool_choice: "auto",
            temperature: 0.7,
        }, { timeout: 30000 }); // Timeout 30 detik untuk stabilitas production

        let responseMessage = response.choices[0].message;

        // === TOOL CALLING HANDLER ===
        if (responseMessage.tool_calls) {
            messages.push(responseMessage);

            let mediaResults = []; // Berubah jadi array untuk multiple media

            for (const toolCall of responseMessage.tool_calls) {

                // TOOL 1: Cek ongkir
                if (toolCall.function.name === 'cek_ongkir_jne') {
                    const args = JSON.parse(toolCall.function.arguments);
                    logger.info(`[Tool] AI mengecek ongkir ke: ${args.destinationCity}`);
                    const ongkirResult = await rajaOngkir.getJneOngkir(args.destinationCity, args.weightGrams || 1000);
                    messages.push({ tool_call_id: toolCall.id, role: "tool", name: "cek_ongkir_jne", content: ongkirResult });
                }

                // TOOL 2: Kirim Media (MULTIPLE SUPPORT)
                if (toolCall.function.name === 'kirim_media_katalog') {
                    const args = JSON.parse(toolCall.function.arguments);
                    const ids = args.media_ids || [];
                    logger.info(`[Tool] AI memilih mengirim media IDs: ${ids.join(', ')}`);

                    if (!agentId) {
                         messages.push({ tool_call_id: toolCall.id, role: "tool", name: "kirim_media_katalog", content: "Gagal: Perangkat ini belum terikat ke agen manapun." });
                         continue;
                    }

                    const foundMedia = await MediaAsset.findAll({
                        where: { id: ids, agent_id: agentId }
                    });

                    // Filter hanya yang boleh dikirim (purpose !== knowledge_only)
                    const allowedMedia = foundMedia.filter(m => m.purpose !== 'knowledge_only');

                    if (allowedMedia.length > 0) {
                        mediaResults = allowedMedia.map(m => ({ media: m, caption: args.caption || "" }));
                        messages.push({
                            tool_call_id: toolCall.id, role: "tool", name: "kirim_media_katalog",
                            content: `${allowedMedia.length} media berhasil dipilih untuk dikirim.`
                        });
                    } else {
                        messages.push({
                            tool_call_id: toolCall.id, role: "tool", name: "kirim_media_katalog",
                            content: "Maaf, ID media yang Anda minta tidak ditemukan atau tidak tersedia untuk dikirim."
                        });
                    }
                }
            }

            // === SECOND AI CALL ===
            const secondResponse = await openai.chat.completions.create({ model: modelName, messages });
            responseMessage = secondResponse.choices[0].message;

            if (mediaResults.length > 0) {
                return {
                    type: RESPONSE_TYPE.MEDIA,
                    content: responseMessage.content?.trim() || "",
                    mediaList: mediaResults // Kembalikan list of media
                };
            }
        }

        return {
            type: RESPONSE_TYPE.TEXT,
            content: responseMessage.content?.trim() || "Ada yang bisa saya bantu?"
        };

    } catch (error) {
        logger.error(`Kesalahan AI: ${error.message}`);
        return { type: RESPONSE_TYPE.TEXT, content: ERRORS.AI_FALLBACK };
    }
}

/**
 * TAHAP 4: Generate Chat Summary (Rekap Pembahasan)
 * Mengubah 20+ chat menjadi 3-5 poin penting status pelanggan.
 */
async function generateChatSummary(history = []) {
    if (history.length < 3) return "Percakapan baru saja dimulai. Belum ada rekapan.";
    
    try {
        const historyText = history.map(h => 
            `${h.is_from_me ? 'Admin' : 'Pelanggan'}: ${h.body || h.content}`
        ).join('\n');

        const response = await openai.chat.completions.create({
            model: config.MODEL_NAME || "gpt-4o-mini",
            messages: [
                { role: "system", content: "Tugasmu adalah membuat REKAP PEMBAHASAN CHAT singkat (3-5 poin). Fokus pada: 1. Nama/identitas pelanggan jika sudah tahu, 2. Produk yang diminati, 3. Progress diskusi (misal: sudah deal harga, baru tanya-tanya, atau mau kirim desain). Gunakan Bahasa Indonesia yang sangat ringkas." },
                { role: "user", content: `Berikut riwayat chatnya, buatkan rekapannya:\n\n${historyText}` }
            ],
            temperature: 0.3 // Lebih stabil untuk rekap
        });

        return response.choices[0].message.content.trim();
    } catch (e) {
        logger.error(`Gagal generate summary: ${e.message}`);
        return "Gagal memperbarui rekapan.";
    }
}

/**
 * TAHAP 5: Voice Note Transcription (Whisper)
 * Mengubah pesan suara (VN) menjadi teks agar AI bisa "mendengar".
 */
async function transcribeAudio(audioPath) {
    if (!fs.existsSync(audioPath)) return null;
    try {
        const response = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: "whisper-1",
            language: "id" // Fokus ke Bahasa Indonesia
        });
        return response.text;
    } catch (e) {
        logger.error(`Gagal transkripsi VN: ${e.message}`);
        return null;
    }
}

/**
 * Menghitung jeda mengetik yang realistis (Natural Human Typing).
 */
function calculateTypingDelay(text, minCharDelay = 60, maxDelay = 5000) {
    if (!text) return 1000;
    const randomSpeed = Math.floor(Math.random() * (100 - 60 + 1)) + 60;
    const baseDelay = text.length * randomSpeed;
    const humanOffset = Math.floor(Math.random() * (1200 - 400 + 1)) + 400;
    return Math.min(baseDelay + humanOffset, maxDelay);
}

module.exports = {
    getAIResponse,
    generateChatSummary,
    transcribeAudio,
    calculateTypingDelay,
    RESPONSE_TYPE
};
