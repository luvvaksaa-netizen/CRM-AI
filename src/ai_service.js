/**
 * @file ai_service.js
 * @description AI Service — Knowledge-Aware Media Architecture.
 *
 * REFACTORED (Production-Grade):
 *  - Deadlock-Proof Concurrency Queue (Promise.finally)
 *  - Timestamp Hallucination Fix (no [WAKTU:] in assistant messages)
 *  - Smarter AI: Contextual memory, edge-case handling, conversation awareness
 *  - Graceful error recovery: queue never freezes
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

// ══════════════════════════════════════════════════════════════════
// FAULT-TOLERANT CONCURRENCY LIMITER (Deadlock-Proof)
// Membatasi AI ke 3 proses serentak. Slot PASTI dibebaskan via finally().
// ══════════════════════════════════════════════════════════════════
let activeRequests = 0;
const MAX_CONCURRENCY = 10;
const pendingQueue = [];
const QUEUE_TIMEOUT_MS = 60 * 1000; // 1 Menit maksimal antre (Hardening Phase 2)

function runNextInQueue() {
    while (activeRequests < MAX_CONCURRENCY && pendingQueue.length > 0) {
        const { resolve, reject, execute, queuedAt } = pendingQueue.shift();
        
        // --- STALE QUEUE PRUNING ---
        // Jika antrean tertunda lebih dari batas waktu, gugurkan (mencegah balasan basi)
        if (Date.now() - queuedAt > QUEUE_TIMEOUT_MS) {
            logger.warn(`[AI Queue] Antrean digugurkan (Stale > 2 mins). OpenAI lambat/down.`);
            resolve({ type: RESPONSE_TYPE.TEXT, content: ERRORS.AI_FALLBACK });
            continue; // Lanjut ke item berikutnya tanpa menambah activeRequests
        }

        activeRequests++;
        
        execute()
            .then(res => resolve(res))
            .catch(err => {
                // KRITIS: Tangkap error agar slot tidak hilang selamanya
                logger.error(`[AI Queue] Error dalam proses: ${err.message}`);
                reject(err);
            })
            .finally(() => {
                // KRITIS: Slot SELALU dibebaskan, apapun yang terjadi
                activeRequests--;
                runNextInQueue();
            });
    }
}

async function getAIResponse(userMessage, history = [], store = null, agent = null, customerMediaContext = "", conversationSummary = "", interactionCount = 1) {
    return new Promise((resolve, reject) => {
        pendingQueue.push({
            resolve,
            reject,
            queuedAt: Date.now(),
            execute: () => _processAIResponse(userMessage, history, store, agent, customerMediaContext, conversationSummary, interactionCount)
        });
        runNextInQueue();
    }).catch(err => {
        // Safety net: jika queue gagal, kembalikan fallback (server TIDAK BOLEH mati)
        logger.error(`[AI] Fallback response triggered: ${err.message}`);
        return { type: RESPONSE_TYPE.TEXT, content: ERRORS.AI_FALLBACK };
    });
}

/**
 * Logika internal pemrosesan AI (Refactored: Smarter & Safer)
 */
async function _processAIResponse(userMessage, history = [], store = null, agent = null, customerMediaContext = "", conversationSummary = "", interactionCount = 1) {
    // Guard: Validasi API Key tanpa crash
    if (!config.OPENAI_API_KEY || !config.OPENAI_API_KEY.startsWith('sk-')) {
        logger.error("OpenAI API Key belum dikonfigurasi atau tidak valid!");
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
                const parts = [`[${icon}]` + (m.label ? ` (Topik: ${m.label})` : '')];
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
                `- ID: ${m.id} | Label: "${m.label || 'Tanpa Label'}" | Tipe: ${m.type} ${m.description ? '| Desc: ' + m.description : ''}`
              ).join('\n')
            : '(Tidak ada media yang bisa dikirim)';

        // ── TIMESTAMP AWARENESS (untuk AI, bukan untuk teks balasan) ─────────
        const nowStr = moment().format('dddd, DD MMMM YYYY HH:mm');

        const fullSystemInstruction = `
${sysPrompt}

═══════════════════════════════════════════
WAKTU SAAT INI: ${nowStr}
═══════════════════════════════════════════
Gunakan informasi waktu ini HANYA untuk konteks internal (misal: menyapa "Selamat pagi" atau "Selamat malam"). 
DILARANG KERAS menulis tanggal/jam/timestamp di dalam teks balasan ke pelanggan.

═══════════════════════════════════════════
INFORMASI PRODUK & KEUNGGULAN (KNOWLEDGE):
═══════════════════════════════════════════
${knowledge}

═══════════════════════════════════════════
PENGETAHUAN DARI MEDIA (Foto & Video):
═══════════════════════════════════════════
${knowledgeSection}

KETERSEDIAAN MEDIA:
- Kamu memiliki ${sendableMedia.length} item di katalog yang bisa dikirim via tool.
- Kamu memiliki ${knowledgeMedia.length} item pengetahuan video/foto.

═══════════════════════════════════════════
KATALOG MEDIA YANG BISA KAMU KIRIM:
═══════════════════════════════════════════
PENTING: Gunakan tool "kirim_media_katalog" untuk mengirim media. Kamu HANYA tahu ID-nya. 
${catalogSection}

═══════════════════════════════════════════
REKAP PEMBAHASAN SEBELUMNYA (Long-Term Memory):
═══════════════════════════════════════════
${conversationSummary || 'Percakapan baru saja dimulai.'}

═══════════════════════════════════════════
PANDUAN KECERDASAN LANJUTAN (Advanced Intelligence):
═══════════════════════════════════════════
Kamu adalah CS yang sangat cerdas. Berikut panduan untuk menangani berbagai situasi tidak terduga:

1. PELANGGAN MARAH/KECEWA: Tunjukkan empati dulu, validasi perasaan mereka, baru tawarkan solusi. Jangan langsung defensif.
2. BAHASA GAUL/TYPO: Pahami maksud dari pesan yang ditulis dengan singkatan atau typo. Misal "brp hrg" = "berapa harga", "gw mw psen" = "saya mau pesan".
3. PESAN AMBIGU: Jika pesan pelanggan sangat ambigu atau hanya berisi emoji/stiker, tanyakan dengan sopan apa yang bisa dibantu.
4. DI LUAR TOPIK: Jika pelanggan bertanya hal yang tidak ada di knowledge, jawab dengan jujur dan arahkan kembali ke produk/layanan.
5. PELANGGAN BARU KEMBALI: Jika ada rekap sebelumnya, sambut kembali dan tanyakan progress dari diskusi terakhir.
6. NEGOSIASI: Bersikap fleksibel tapi tegas. Arahkan ke value produk, bukan perang harga.
7. SPAM/ISENG: Jika pelanggan mengirim hal tidak relevan berulang kali, tetap profesional dan singkat.
8. MULTI-BAHASA: Jika pelanggan chat dalam bahasa Inggris atau bahasa lain, balas dalam bahasa yang sama.
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
                            destinationCity: { type: "string", description: "Nama KOTA atau KABUPATEN tujuan. Jika pelanggan memberikan alamat lengkap (contoh: Desa Patihan, Kecamatan Loceret, Kabupaten Nganjuk), ekstrak HANYA nama Kabupaten/Kota-nya (contoh: 'Nganjuk')." },
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
            },
            {
                type: "function",
                function: {
                    name: "tambahkan_label_chat",
                    description: "Menambahkan label khusus ke kontak WhatsApp pelanggan (misal: 'Hot Lead', 'Komplain', 'Menunggu Pembayaran'). Gunakan HANYA label yang tersedia dari konfigurasi.",
                    parameters: {
                        type: "object",
                        properties: {
                            label_name: { type: "string", description: "Nama label yang ingin ditambahkan." }
                        },
                        required: ["label_name"]
                    }
                }
            }
        ];

        // ══════════════════════════════════════════════════════════════════
        // BUILD MESSAGES — FIX TIMESTAMP HALLUCINATION
        // Timestamp HANYA diberikan untuk role 'user', TIDAK untuk 'assistant'
        // ══════════════════════════════════════════════════════════════════
        let userContent = userMessage;
        if (customerMediaContext) {
            userContent = `[SISTEM: Pelanggan baru saja mengirim MEDIA/FOTO. Berikut adalah deskripsi visualnya untuk panduanmu: ${customerMediaContext}]\n\nPESAN PELANGGAN: ${userMessage || '(Hanya mengirim foto)'}`;
        }

        const filteredHistory = history.length > 0 
            ? history.slice(0, history.length - 1) 
            : [];

        // ══════════════════════════════════════════════════════════════════
        // STRATEGI PRIORITAS TERBALIK (BOTTOM-WEIGHTED)
        // Aturan Draconian diletakkan di instruksi sistem terakhir.
        // ══════════════════════════════════════════════════════════════════
const draconianRules = `
--- [ATURAN MUTLAK & TEKNIS - WAJIB PATUH] ---
1. STATUS: Ini adalah interaksi ke-${interactionCount}.
2. DILARANG KERAS: Menulis karakter ![...](...) atau link http/example.com apapun di teks balasan. 
3. DILARANG KERAS: Menulis ID Media, timestamp, atau informasi teknis apapun di dalam teks balasan. Pelanggan tidak boleh tahu sistem ID kita.
4. DILARANG KERAS: Menulis [WAKTU:...] atau tanggal/jam apapun di teks balasan. Gunakan informasi waktu HANYA untuk konteks sapaan.
5. PENGGUNAAN TOOL ONGKIR: Jika pelanggan sudah memberikan alamat lengkap (terutama Kecamatan dan Kabupaten/Kota), kamu WAJIB memanggil tool 'cek_ongkir_jne'. DILARANG merespons dengan kalimat "Ongkir akan dicek" atau membiarkannya kosong.
6. ATURAN REKAPITULASI (MEMORY): Saat memberikan Rekap Pesanan, kamu WAJIB menuliskan SEMUA data spesifik secara rinci (misalnya: Tuliskan kelima nama tersebut satu per satu). JANGAN PERNAH meringkas nama menjadi angka (misal "Nama: 5 nama").
7. LOGIKA MATEMATIKA PESANAN: Pahami kelipatan paket. Jika 1 paket maksimal 4 nama, maka 2 paket = maksimal 8 nama, 3 paket = maksimal 12 nama. Jadi jika pelanggan pesan 2 paket untuk 5 nama, itu SANGAT DIPERBOLEHKAN karena 5 < 8.
8. Jangan ulangi pertanyaan yang sudah dijawab user di riwayat.
9. Balas dengan SATU pesan yang lengkap dan koheren. JANGAN memecah menjadi beberapa balasan terpisah.

--- [KETERANGAN PENTING: KEPRIBADIAN & ATURAN UTAMA] ---
${sysPrompt}
---`.trim();

        let messages = [
            { role: "system", content: fullSystemInstruction },
            // Riwayat chat: Timestamp hanya untuk USER, BUKAN assistant
            ...filteredHistory.map(h => {
                if (h.is_from_me) {
                    // Assistant: TANPA timestamp (mencegah halusinasi copy-paste timestamp)
                    return {
                        role: 'assistant',
                        content: h.body || h.content || ""
                    };
                } else {
                    // User: Dengan konteks waktu (untuk awareness AI)
                    const dayStr = h.timestamp ? moment(h.timestamp).format('DD MMM HH:mm') : "";
                    return {
                        role: 'user',
                        content: dayStr ? `(Dikirim ${dayStr})\n${h.body || h.content || ""}` : (h.body || h.content || "")
                    };
                }
            }),
            { 
                role: "system", 
                content: draconianRules
            },
            { role: "user", content: userContent }
        ];

        // === FIRST AI CALL (with timeout) ===
        const response = await openai.chat.completions.create({
            model: modelName,
            messages,
            tools,
            tool_choice: "auto",
            temperature: 0.7,
        }, { timeout: 30000 });

        let responseMessage = response.choices[0].message;

        // === TOOL CALLING HANDLER ===
        if (responseMessage.tool_calls) {
            messages.push(responseMessage);
            let mediaResults = [];
            let needsSecondCall = false;

            for (const toolCall of responseMessage.tool_calls) {
                try {
                    if (toolCall.function.name === 'cek_ongkir_jne') {
                        const args = JSON.parse(toolCall.function.arguments);
                        const ongkirResult = await rajaOngkir.getJneOngkir(args.destinationCity, args.weightGrams || 1000);
                        messages.push({ tool_call_id: toolCall.id, role: "tool", name: "cek_ongkir_jne", content: ongkirResult });
                        needsSecondCall = true;
                    }

                    if (toolCall.function.name === 'tambahkan_label_chat') {
                        const args = JSON.parse(toolCall.function.arguments);
                        messages.push({ tool_call_id: toolCall.id, role: "tool", name: "tambahkan_label_chat", content: `Label '${args.label_name}' diteruskan ke sistem.` });
                        // Execution of the actual label happens downstream (in message_handler)
                        needsSecondCall = true;
                    }

                    if (toolCall.function.name === 'kirim_media_katalog') {
                        const args = JSON.parse(toolCall.function.arguments);
                        const ids = args.media_ids || [];
                        if (!agentId) {
                             messages.push({ tool_call_id: toolCall.id, role: "tool", name: "kirim_media_katalog", content: "Gagal: Agent ID tidak ditemukan." });
                             needsSecondCall = true;
                             continue;
                        }
                        const foundMedia = await MediaAsset.findAll({ where: { id: ids, agent_id: agentId } });
                        const allowedMedia = foundMedia.filter(m => m.purpose !== 'knowledge_only');

                        if (allowedMedia.length > 0) {
                            mediaResults = allowedMedia.map(m => ({ media: m, caption: args.caption || "" }));
                            messages.push({ tool_call_id: toolCall.id, role: "tool", name: "kirim_media_katalog", content: `${allowedMedia.length} media berhasil dikirim.` });
                            // For catalog sending, we don't need a second API call. The caption IS the message.
                        } else {
                            messages.push({ tool_call_id: toolCall.id, role: "tool", name: "kirim_media_katalog", content: "Media tidak ditemukan." });
                            needsSecondCall = true;
                        }
                    }
                } catch (toolErr) {
                    logger.error(`[AI] Tool call error [${toolCall.function.name}]: ${toolErr.message}`);
                    messages.push({ tool_call_id: toolCall.id, role: "tool", name: toolCall.function.name, content: `Error: ${toolErr.message}` });
                    needsSecondCall = true;
                }
            }

            let finalContent = "";
            if (needsSecondCall) {
                const secondResponse = await openai.chat.completions.create({ 
                    model: modelName, 
                    messages: [
                        ...messages,
                        { role: "system", content: "PENGINGAT TEKNIS: Jangan tulis link/tag media/ID/timestamp apapun di teks jawaban akhir. Cukup balas teks ramah saja." }
                    ]
                });
                responseMessage = secondResponse.choices[0].message;
                finalContent = responseMessage.content;
            }

            if (mediaResults.length > 0) {
                return {
                    type: RESPONSE_TYPE.MEDIA,
                    content: finalContent ? sanitizeTextOutput(finalContent) : "",
                    mediaList: mediaResults,
                    tool_calls: responseMessage.tool_calls || [] // Pass tool calls downstream
                };
            }
            
            return {
                type: RESPONSE_TYPE.TEXT,
                content: sanitizeTextOutput(finalContent) || "Ada yang bisa saya bantu?",
                tool_calls: responseMessage.tool_calls || []
            };
        }

        return {
            type: RESPONSE_TYPE.TEXT,
            content: sanitizeTextOutput(responseMessage.content) || "Ada yang bisa saya bantu?",
            tool_calls: responseMessage.tool_calls || []
        };

    } catch (error) {
        logger.error(`Kesalahan AI: ${error.message}`);
        return { type: RESPONSE_TYPE.TEXT, content: ERRORS.AI_FALLBACK };
    }
}

/**
 * MASTER SANITIZER (Guard Level Production)
 * Menghapus segala bentuk link fiktif, format markdown gambar, atau tag media manual
 * sebelum pesan benar-benar sampai ke WhatsApp pelanggan.
 */
function sanitizeTextOutput(text) {
    if (!text) return "";
    
    let clean = text;
    // 1. Hapus format Markdown Image: ![...](...) 
    clean = clean.replace(/!\[.*?\]\(.*?\)/g, '');
    
    // 2. Hapus format link fiktif: example.com, atau http:// fiktif
    clean = clean.replace(/https?:\/\/\S+/gi, '');
    clean = clean.replace(/[a-zA-Z0-9-]+\.com\S*/gi, '');
    
    // 3. Hapus tag internal jika bocor: [MEDIA:...] atau [VIDEO:...]
    clean = clean.replace(/\[MEDIA:.*?\]/g, '');
    clean = clean.replace(/\[VIDEO:.*?\]/g, '');
    
    // 4. Hapus ID sistem jika bocor (misal: ID: 2)
    clean = clean.replace(/ID:\s*\d+/gi, '');

    // 5. Hapus timestamp yang bocor: [WAKTU: ...] atau (Dikirim ...)
    clean = clean.replace(/\[WAKTU:.*?\]/gi, '');
    clean = clean.replace(/\(Dikirim \d{2} \w{3} \d{2}:\d{2}\)/gi, '');

    // 6. Normalisasi spasi dan baris kosong berlebih
    return clean.trim().replace(/\n{3,}/g, '\n\n');
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
function calculateTypingDelay(text, minCharDelay = 60, maxDelay = 1000) {
    if (!text) return 1000;
    const randomSpeed = Math.floor(Math.random() * (50 - 30 + 1)) + 30; // Faster
    const baseDelay = text.length * randomSpeed;
    const humanOffset = Math.floor(Math.random() * (500 - 200 + 1)) + 200;
    return Math.min(baseDelay + humanOffset, maxDelay);
}

module.exports = {
    getAIResponse,
    generateChatSummary,
    transcribeAudio,
    calculateTypingDelay,
    RESPONSE_TYPE
};
