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

const AI_CHAT_TIMEOUT_MS = Number(process.env.OPENAI_CHAT_TIMEOUT_MS || 18000);
const AI_SECOND_CALL_TIMEOUT_MS = Number(process.env.OPENAI_SECOND_CALL_TIMEOUT_MS || Math.min(AI_CHAT_TIMEOUT_MS, 10000));
const AI_MEDIA_FAST_REPLY_ENABLED = process.env.AI_MEDIA_FAST_REPLY_ENABLED !== 'false';
const NORMAL_BUBBLE_MAX_WORDS = Number(process.env.AI_MAX_BUBBLE_WORDS || 10);

function parseAutoLabels(value = '') {
    return String(value || '')
        .split(',')
        .map(label => label.trim())
        .filter(Boolean)
        .filter((label, index, list) => list.findIndex(x => x.toLowerCase() === label.toLowerCase()) === index);
}

function countWords(text = '') {
    return (String(text).trim().match(/\S+/g) || []).length;
}

function isStructuredReply(text = '') {
    return /(\*Nama\*|\*Alamat\*|\*Pesanan\*|\*Harga\*|\*Ongkir\*|\*total\*|rekening|rekap|detail pemesanan|transfer|cod)/i.test(String(text || ''));
}

function inferAgentProductKind(agent = {}, mediaResults = []) {
    const haystack = [
        agent.name,
        agent.system_prompt,
        agent.product_knowledge,
        ...mediaResults.map(item => item?.media?.label)
    ].join(' ').toLowerCase();

    if (/\buv\b|stiker keras|timbul|botol|helm|tumbler/.test(haystack)) return 'uv';
    if (/\bdtf\b|setrika|baju|kain|seragam|hijab/.test(haystack)) return 'dtf';
    return 'generic';
}

function buildFastMediaReply(agent, mediaResults = [], interactionCount = 1) {
    const kind = inferAgentProductKind(agent, mediaResults);
    if (interactionCount === 1 && kind === 'uv') {
        return 'Hai kak! Ini stiker UV kami 😊\nMau varian yang mana kak?';
    }
    if (interactionCount === 1 && kind === 'dtf') {
        return 'Hai kak! Ini label DTF kami 😊\nMau varian yang mana kak?';
    }
    return 'Ini ya kak 😊\nMau pilih yang mana kak?';
}

function splitLongBubble(text, maxWords = NORMAL_BUBBLE_MAX_WORDS) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return [String(text || '').trim()].filter(Boolean);

    const chunks = [];
    for (let i = 0; i < words.length; i += maxWords) {
        chunks.push(words.slice(i, i + maxWords).join(' '));
    }
    return chunks;
}

function prepareOutboundBubbles(text, maxWords = NORMAL_BUBBLE_MAX_WORDS) {
    const clean = sanitizeTextOutput(text);
    if (!clean) return [];

    // Rekap/order/payment perlu tetap utuh supaya data transaksi tidak hilang.
    if (isStructuredReply(clean)) return [clean];

    const parts = clean
        .split(/\n+/)
        .map(part => part.trim())
        .filter(Boolean);

    const bubbles = [];
    for (const part of parts.length ? parts : [clean]) {
        if (countWords(part) <= maxWords) {
            bubbles.push(part);
            continue;
        }

        const sentences = part
            .split(/(?<=[.!?])\s+/)
            .map(sentence => sentence.trim())
            .filter(Boolean);

        for (const sentence of sentences.length ? sentences : [part]) {
            bubbles.push(...splitLongBubble(sentence, maxWords));
        }
    }

    return bubbles;
}

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
        // BOT_NAME: Store override > Agent default (1 Agent, banyak nama CS per-WA)
        const botName = (store?.bot_name || agent?.bot_name || 'CS Bot').trim();
        const rawSysPrompt = agent?.system_prompt || store?.system_prompt || 'Anda adalah admin CS yang ramah.';
        const sysPrompt = rawSysPrompt.replace(/\{BOT_NAME\}/gi, botName);
        const knowledge = agent?.product_knowledge || store?.product_knowledge || 'Kami melayani pembuatan barang berkualitas.';
        const modelName = config.MODEL_NAME || 'gpt-4o-mini';
        const agentId   = agent?.id || null;
        const configuredLabels = parseAutoLabels(agent?.auto_labels);

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

        const labelSection = configuredLabels.length > 0
            ? configuredLabels.map(label => `- ${label}`).join('\n')
            : '(Belum ada label otomatis yang dikonfigurasi untuk agen ini)';

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

LABEL OTOMATIS YANG BOLEH DIPAKAI:
${labelSection}

═══════════════════════════════════════════
STATUS PERCAKAPAN & INSTRUKSI KONTEKSTUAL:
═══════════════════════════════════════════
INTERAKSI KE-${interactionCount} DENGAN PELANGGAN INI.
${interactionCount === 1
  ? `⚠️ INI PESAN PERTAMA PELANGGAN INI! WAJIB LAKUKAN OPENING FLOW SESUAI AGENT INI:\n1. Ikuti label media yang tertulis di prompt/knowledge agent dan tersedia di katalog.\n2. Agent DTF kain biasanya memakai ["katalog dtf", "video dtf"]. Agent UV/stiker keras biasanya memakai ["katalog uv", "video uv"].\n3. Jangan memakai katalog/video produk lain.\n4. Kirim teks pendek sesuai opening agent setelah media dipilih.\nJANGAN bertanya nomor pesanan atau data apapun sebelum langkah opening selesai!`
  : `REKAP PEMBAHASAN SEBELUMNYA (Long-Term Memory):\n${conversationSummary || 'Percakapan sedang berlangsung.'}`
}

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
                            destinationCity: { type: "string", description: "Nama KECAMATAN dan KOTA/KABUPATEN tujuan. Jika pelanggan memberikan alamat lengkap (contoh: Desa Patihan, Kecamatan Loceret, Kabupaten Nganjuk), ekstrak format 'Kecamatan, Kabupaten/Kota' (contoh: 'Loceret, Nganjuk') untuk hasil yang presisi." },
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
                    description: "Mengirimkan foto/video produk ke pelanggan berdasarkan ID atau nama label.",
                    parameters: {
                        type: "object",
                        properties: {
                            media_ids: { 
                                type: "array", 
                                items: { type: "integer" },
                                description: "Array ID media (Opsional, gunakan label_names jika lebih mudah)." 
                            },
                            label_names: { 
                                type: "array", 
                                items: { type: "string" },
                                description: "Array nama label dari media yang ingin dikirim (misal: ['katalog dtf', 'video dtf'] atau ['katalog uv', 'video uv'])." 
                            },
                            caption: { type: "string", description: "Teks penjelasan singkat untuk media." }
                        }
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "matikan_bot_kontak",
                    description: "Mem-pause bot untuk kontak ini jika percakapan harus dilanjutkan CS manusia, misalnya produk di luar scope agent, komplain berat, atau kasus yang berisiko.",
                    parameters: {
                        type: "object",
                        properties: {
                            reason: {
                                type: "string",
                                description: "Alasan singkat kenapa bot harus dipause."
                            }
                        },
                        required: ["reason"]
                    }
                }
            }
        ];

        if (configuredLabels.length > 0) {
            tools.push({
                type: "function",
                function: {
                    name: "tambahkan_label_chat",
                    description: "Menambahkan label khusus ke kontak WhatsApp pelanggan. Gunakan HANYA label yang tersedia dari konfigurasi agen.",
                    parameters: {
                        type: "object",
                        properties: {
                            label_name: {
                                type: "string",
                                enum: configuredLabels,
                                description: "Nama label persis dari daftar label otomatis agen."
                            }
                        },
                        required: ["label_name"]
                    }
                }
            });
        }

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

        // Build structured customer data from conversation summary (anti-lupa)
        const knownDataSection = conversationSummary && conversationSummary !== 'Percakapan baru saja dimulai.'
            ? `\n--- [⚠️ DATA CUSTOMER YANG SUDAH DIKETAHUI — DILARANG KERAS TANYA LAGI] ---\n${conversationSummary}\nPENTING: Data di atas sudah dikumpulkan dari percakapan sebelumnya. DILARANG KERAS menanyakan ulang data yang statusnya BUKAN "belum". Jika ada data yang sudah ada, LANGSUNG gunakan tanpa bertanya.\n---`
            : '\n(Pelanggan baru. Mulai dengan opening flow sesuai prompt agent dan label media produk agent ini.)';

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
7. LOGIKA MATEMATIKA PESANAN: Pahami kelipatan paket. Jika 1 paket maksimal 2 nama, maka 2 paket = maksimal 4 nama, 3 paket = maksimal 6 nama. Jadi jika pelanggan pesan 2 paket untuk 3 nama, itu SANGAT DIPERBOLEHKAN karena 3 < 4.
8. ⚠️ ANTI-LUPA: JANGAN PERNAH ulangi pertanyaan yang sudah dijawab customer. Lihat DATA CUSTOMER DI BAWAH — jika data sudah terisi, GUNAKAN langsung tanpa bertanya ulang. Customer MARAH jika ditanya ulang.
9. Untuk chat normal, boleh gunakan beberapa baris. Setiap baris akan dikirim sebagai satu bubble WhatsApp pendek (maksimal 10 kata).
10. Setiap bubble normal MAKSIMAL 10 kata. Jika perlu lebih dari 10 kata, pecah ke baris berikutnya.
11. Khusus rekap order, alamat, rekening, ongkir, dan rincian pembayaran: boleh lebih panjang, tetapi harus lengkap dan rapi.
12. Jika prompt agen berisi FLOW WAJIB/opening/media, ikuti urutannya. Untuk gambar/katalog/varian, gunakan tool "kirim_media_katalog" dengan label media yang paling sesuai.
13. Jika prompt agen melarang jawab harga terlalu cepat, jangan jawab harga sebelum syarat interaksi pada prompt terpenuhi.
14. Jika prompt agen meminta bot dimatikan/dialihkan ke CS manusia, gunakan tool "matikan_bot_kontak" dan tetap kirim jawaban sopan terakhir.

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
            temperature: 0.55,
        }, { timeout: AI_CHAT_TIMEOUT_MS });

        let responseMessage = response.choices[0].message;
        const downstreamToolCalls = responseMessage.tool_calls || [];

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

                    if (toolCall.function.name === 'matikan_bot_kontak') {
                        const args = JSON.parse(toolCall.function.arguments || '{}');
                        messages.push({ tool_call_id: toolCall.id, role: "tool", name: "matikan_bot_kontak", content: `Bot akan dipause untuk kontak ini. Alasan: ${args.reason || 'perlu CS manusia'}` });
                        needsSecondCall = true;
                    }

                    if (toolCall.function.name === 'kirim_media_katalog') {
                        const args = JSON.parse(toolCall.function.arguments);
                        const ids = args.media_ids || [];
                        const labels = args.label_names || (args.label ? [args.label] : []);
                        
                        if (!agentId) {
                             messages.push({ tool_call_id: toolCall.id, role: "tool", name: "kirim_media_katalog", content: "Gagal: Agent ID tidak ditemukan." });
                             needsSecondCall = true;
                             continue;
                        }
                        
                        const sendableMedia = await getSendableMedia(agentId);
                        const allowedMedia = sendableMedia.filter(m => 
                            ids.includes(m.id) || 
                            labels.some(l => {
                                if (!m.label) return false;
                                const mLbl = m.label.toLowerCase().trim();
                                const qLbl = l.toLowerCase().trim();
                                // Exact match ATAU contains match (fuzzy)
                                return mLbl === qLbl || mLbl.includes(qLbl) || qLbl.includes(mLbl);
                            })
                        );

                        if (allowedMedia.length > 0) {
                            mediaResults.push(...allowedMedia.map(m => ({ media: m, caption: args.caption || "" })));
                            messages.push({ tool_call_id: toolCall.id, role: "tool", name: "kirim_media_katalog", content: `${allowedMedia.length} media berhasil dikirim.` });
                            needsSecondCall = true;
                        } else {
                            const availableLabels = sendableMedia.map(m => m.label).filter(Boolean).join(', ');
                            messages.push({ tool_call_id: toolCall.id, role: "tool", name: "kirim_media_katalog", content: `Media tidak ditemukan untuk label: ${labels.join(', ')}. Label yang tersedia: ${availableLabels || '(kosong, belum ada media)'}` });
                            needsSecondCall = true;
                        }
                    }
                } catch (toolErr) {
                    logger.error(`[AI] Tool call error [${toolCall.function.name}]: ${toolErr.message}`);
                    messages.push({ tool_call_id: toolCall.id, role: "tool", name: toolCall.function.name, content: `Error: ${toolErr.message}` });
                    needsSecondCall = true;
                }
            }

            const toolNames = responseMessage.tool_calls.map(tc => tc.function.name);
            const canFastReturnMedia = AI_MEDIA_FAST_REPLY_ENABLED &&
                mediaResults.length > 0 &&
                toolNames.every(name => name === 'kirim_media_katalog');
            let finalContent = sanitizeTextOutput(responseMessage.content || "");

            if (needsSecondCall && !canFastReturnMedia) {
                const secondResponse = await openai.chat.completions.create({ 
                    model: modelName, 
                    messages: [
                        ...messages,
                        { role: "system", content: "PENGINGAT TEKNIS: Jangan tulis link/tag media/ID/timestamp. Untuk chat normal, pisahkan bubble dengan newline dan maksimal 10 kata per bubble. Untuk rekap/order/payment, tulis lengkap dan rapi." }
                    ],
                    temperature: 0.45
                }, { timeout: AI_SECOND_CALL_TIMEOUT_MS });
                responseMessage = secondResponse.choices[0].message;
                finalContent = responseMessage.content;
            } else if (canFastReturnMedia && !finalContent) {
                finalContent = buildFastMediaReply(agent, mediaResults, interactionCount);
            }

            if (mediaResults.length > 0) {
                return {
                    type: RESPONSE_TYPE.MEDIA,
                    content: finalContent ? sanitizeTextOutput(finalContent) : "",
                    mediaList: mediaResults,
                    tool_calls: downstreamToolCalls
                };
            }
            
            return {
                type: RESPONSE_TYPE.TEXT,
                content: sanitizeTextOutput(finalContent) || "Ada yang bisa saya bantu?",
                tool_calls: downstreamToolCalls
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
    
    // 2. Hapus format link fiktif, tetapi jangan hapus nama brand valid seperti slaludiskon.com.
    clean = clean.replace(/https?:\/\/\S+/gi, '');
    clean = clean.replace(/\b(example|yourdomain|domain|website)\.com\S*/gi, '');
    
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
 * Mengubah chat menjadi rekap operasional yang cukup detail untuk CS.
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
                { role: "system", content: `Tugasmu membuat REKAP DATA CUSTOMER dalam format KEY-VALUE yang terstruktur.
Ekstrak SEMUA informasi yang sudah disebutkan customer.
Gunakan format PERSIS seperti ini (isi setiap field, tulis "belum" jika belum diketahui):

NAMA CUSTOMER: [nama pemesan atau "belum"]
PRODUK DIMINATI: [Label DTF / Label DTF UV / belum jelas]
VARIAN: [varian 1/2/3/4 atau "belum"]
WARNA: [warna pilihan atau "belum"]
TEKS LABEL: [nama-nama yang mau dicetak, tulis semua satu per satu, atau "belum"]
JUMLAH: [jumlah paket atau pcs, atau "belum"]
DETAIL PER NAMA: [pembagian jumlah per nama, misal "Andi 25, Budi 25" atau "belum"]
ALAMAT: [alamat lengkap atau "belum"]
HARGA: [sudah disebutkan / belum]
ONGKIR: [sudah dicek / belum]
METODE BAYAR: [Transfer / COD / belum]
STATUS: [opening / gali kebutuhan / negosiasi / menunggu alamat / menunggu rekap / menunggu transfer / closing / selesai]
UPSELLING_TERKIRIM: [ya / belum]
NEXT ACTION: [apa langkah selanjutnya yang perlu dilakukan bot]
CATATAN: [info penting lain, keluhan, permintaan khusus]` },
                { role: "user", content: `Berikut riwayat chatnya, buatkan rekapannya:\n\n${historyText}` }
            ],
            temperature: 0.2 // Lebih stabil dan konsisten untuk format terstruktur
        }, { timeout: AI_CHAT_TIMEOUT_MS });

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
function calculateTypingDelay(text, minCharDelay = 12, maxDelay = 300) {
    if (!text) return 150;
    const randomSpeed = Math.floor(Math.random() * (22 - minCharDelay + 1)) + minCharDelay;
    const baseDelay = text.length * randomSpeed;
    const humanOffset = Math.floor(Math.random() * (100 - 50 + 1)) + 50;
    return Math.min(baseDelay + humanOffset, maxDelay);
}

module.exports = {
    getAIResponse,
    generateChatSummary,
    transcribeAudio,
    calculateTypingDelay,
    prepareOutboundBubbles,
    sanitizeTextOutput,
    parseAutoLabels,
    RESPONSE_TYPE
};
