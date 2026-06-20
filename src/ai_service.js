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
const mengantarService = require('./services/mengantar_service');
const { getSendableMedia, getKnowledgeMedia } = require('./services/media_service');
const { MediaAsset } = require('./database/index');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
const { buildLearningPromptSection } = require('./services/learning_service');

// ── Scalev Order+Payment Service (lazy load) ──
// Menjadi metode pembayaran UTAMA jika SCALEV_API_KEY dikonfigurasi.
let _scalevSvc = null;
function getScalevService() {
    if (_scalevSvc) return _scalevSvc;
    try {
        const svc = require('./services/scalev_service');
        if (svc && svc.createOrderAndPay) {
            _scalevSvc = svc;
            logger.info('[AI-Legacy] Scalev service loaded (createOrderAndPay ready).');
        } else {
            logger.warn('[AI-Legacy] Scalev service ditemukan tapi createOrderAndPay tidak tersedia.');
        }
    } catch (err) {
        logger.warn(`[AI-Legacy] Scalev service tidak bisa dimuat: ${err.message}`);
    }
    return _scalevSvc;
}

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

/**
 * Deteksi apakah respons adalah pesan terstruktur (rekap/order/rekening).
 * Rekap harus selalu dikirim utuh tanpa dipotong bubble.
 */
function isStructuredReply(text = '') {
    return /rekap\s+pesanan|produk\s*:|nama\s+cetak\s*:|total\s+pesanan\s*:|ongkir\s+(awal|ke)\s*:|metode\s+pembayaran\s*:|harga\s+produk\s*:|total\s+harus\s+dibayar|balas\s+iya|bank\s+(bca|mandiri|bri)/i.test(String(text || ''));
}


/**
 * Bersihkan teks respons AI dari noise sebelum dikirim ke WhatsApp.
 * - Hapus baris berupa catatan internal AI: (Kirim gambar...), (Kirim video...), [SISTEM:...], dsb.
 * - Normalisasi whitespace berlebih.
 */
function sanitizeTextOutput(text = '') {
    if (!text) return '';
    const lines = String(text)
        .split('\n')
        .map(line => line.trim())
        .filter(line => {
            if (!line) return false;
            // Hapus baris yang hanya berisi catatan/action AI dalam kurung atau bracket
            if (/^\(Kirim/i.test(line)) return false;
            if (/^\[Kirim/i.test(line)) return false;
            if (/^\(Mengirim/i.test(line)) return false;
            if (/^\[SISTEM:/i.test(line)) return false;
            if (/^\[AI-/i.test(line)) return false;
            if (/^\*\s*\(Kirim/i.test(line)) return false;
            // Hapus baris yang hanya berisi tanda baca / emoji saja
            if (/^[\s\p{Emoji}\-_*#>]+$/u.test(line) && line.length < 4) return false;
            return true;
        })
        .join('\n');
    // Normalisasi: lebih dari 2 baris kosong berturut → 2
    return lines.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Inferensi tipe produk utama agen.
 * Mendukung: 'dtf' | 'uv' | 'bts' | 'generic'
 * Prioritas: bts > uv > dtf > generic
 */
function inferAgentProductKind(agent = {}, mediaList = []) {
    const safeAgent = agent || {};
    const haystack = [
        safeAgent.name,
        safeAgent.system_prompt,
        safeAgent.product_knowledge,
        ...mediaList.map(item => item?.media?.label || item?.label || '')
    ].join(' ').toLowerCase();

    if (/\bbts\b|back.to.school|bundling.bts|stiker.buku|alat.tulis|tempat.makan/.test(haystack)) return 'bts';
    if (/\buv\b|stiker.keras|timbul|botol|helm|tumbler/.test(haystack)) return 'uv';
    if (/\bdtf\b|setrika|baju|kain|seragam|hijab/.test(haystack)) return 'dtf';
    return 'generic';
}


/**
 * Auto-inject media jika AI menyebut media dalam teks tapi TIDAK memanggil tool.
 * Safety net: deteksi keyword referensi media → kirim media otomatis.
 * @param {string} content  - Teks respons AI
 * @param {string} kind     - 'dtf' | 'uv' | 'generic'
 * @param {Array}  sendableMedia - Daftar media yang bisa dikirim dari DB
 * @returns {Array|null} - Array media untuk dikirim, atau null jika tidak ada
 */
function _autoInjectMedia(content, kind, sendableMedia) {
    if (!content || !sendableMedia || sendableMedia.length === 0) return null;

    const lower = content.toLowerCase();

    // Keyword yang menandakan AI ingin tunjukkan media tapi lupa panggil tool
    const VIDEO_REF     = ['videonya', 'video cara', 'cek video', 'tonton video', 'lihat video', 'video kami', 'kirim video', 'ada video'];
    const KATALOG_REF   = ['katalognya', 'pilihan font', 'varian font', 'lihat pilihan', 'foto varian', 'lihat katalog', 'pilihan warna', 'cek katalog', 'katalog kami', 'pilihan kami'];
    const TESTIMONI_REF = ['testimoni', 'review customer', 'bukti nyata', 'foto testimoni', 'hasil pelanggan', 'hasil aslinya', 'ini hasilnya', 'contoh hasil', 'realpict', 'real pic'];
    const VALUE_REF     = ['keunggulan produk', 'nilai produk', 'kenapa pilih', 'premium lho', 'kualitas produk'];

    // Dinamis re-detect kind dari teks respons AI (override jika disebut eksplisit)
    let dynamicKind = kind;
    if (/\b(dtf|baju|kain|seragam|setrika|hijab)\b/i.test(lower)) dynamicKind = 'dtf';
    else if (/\b(bts|bundling|stiker.buku|alat.tulis|tempat.makan)\b/i.test(lower)) dynamicKind = 'bts';
    else if (/\b(uv|keras|botol|helm|tumbler|kaca)\b/i.test(lower)) dynamicKind = 'uv';

    const suffix = dynamicKind === 'uv' ? 'uv' : (dynamicKind === 'bts' ? 'bts' : 'dtf');

    const targetLabels = [];
    if (VIDEO_REF.some(kw     => lower.includes(kw))) targetLabels.push(`video ${suffix}`);
    if (KATALOG_REF.some(kw   => lower.includes(kw))) targetLabels.push(`katalog ${suffix}`);
    if (TESTIMONI_REF.some(kw => lower.includes(kw))) targetLabels.push(`testimoni ${suffix}`);
    if (VALUE_REF.some(kw     => lower.includes(kw))) targetLabels.push(`value ${suffix}`);

    if (targetLabels.length === 0) return null;

    const results = [];
    for (const targetLabel of targetLabels) {
        const [word1, word2] = targetLabel.split(' ');
        
        // Temukan semua media yang cocok dengan keyword
        const matchesForLabel = sendableMedia.filter(m => {
            if (!m.label) return false;
            const lbl = m.label.toLowerCase();
            return lbl.includes(word1) && (kind === 'generic' || (word2 && lbl.includes(word2)));
        });

        const videos = matchesForLabel.filter(m => (m.type || '').startsWith('video'));
        const images = matchesForLabel.filter(m => (m.type || '').startsWith('image'));

        // Inject 1 RANDOM foto/image jika ada lebih dari 1 (Fix Media Spam)
        if (images.length > 0) {
            const randomImage = images[Math.floor(Math.random() * images.length)];
            if (!results.find(r => r.id === randomImage.id)) {
                results.push(randomImage);
            }
        }

        // Inject 1 RANDOM video jika ada lebih dari 1
        if (videos.length > 0) {
            const randomVideo = videos[Math.floor(Math.random() * videos.length)];
            if (!results.find(r => r.id === randomVideo.id)) {
                results.push(randomVideo);
            }
        }
    }

    return results.length > 0 ? results : null;
}

function buildFastMediaReply(agent, interactionCount = 1) {
    const kind = inferAgentProductKind(agent);
    
    // Variasi copywriting agar tidak dianggap SPAM oleh WhatsApp (anti-banned)
    const uvVariations = [
        'Promo Stiker UV nya masih ada bun 😊\nMau pilih varian yang mana nih?',
        'Untuk Stiker UV timbulnya ready bun 🥰\nBunda mau pilih varian yang mana?',
        'Stiker UV kita masih promo ya bun 😊\nSilakan dipilih variannya bun',
        'Stiker UV anti airnya ready bun 😍\nBunda suka varian yang mana?'
    ];
    
    const dtfVariations = [
        'Promo Label Nama DTF masih tersedia ya bun 😊\nMau pilih varian yang mana bun?',
        'Label setrika bajunya ready bun 🥰\nBunda mau pilih varian font yang mana nih?',
        'Label DTF kita masih promo ya bun 😊\nSilakan dipilih varian fontnya',
        'Label baju anti luntur ready bun 😍\nBunda suka varian font nomor berapa?'
    ];
    
    const genericVariations = [
        'Ini ya bun 😊\nMau pilih yang mana bun?',
        'Silakan dilihat bun 🥰\nMau pilih yang mana nih?',
        'Bisa dicek dulu bun gambarnya 😊\nMau pilih yang mana?',
        'Ini contohnya ya bun 😍\nKira-kira bunda suka yang mana?'
    ];

    const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

    if (interactionCount === 1 && kind === 'uv') return pickRandom(uvVariations);
    if (interactionCount === 1 && kind === 'dtf') return pickRandom(dtfVariations);
    
    return pickRandom(genericVariations);
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

function prepareOutboundBubbles(text) {
    const clean = sanitizeTextOutput(text);
    if (!clean) return [];

    // Rekap/order/payment harus tetap utuh supaya data transaksi tidak hilang.
    if (isStructuredReply(clean)) return [clean];

    // Pecah hanya di ENTER GANDA (\n\n) — batas alami antar bubble.
    // Single newline dianggap masih 1 bubble (misal: list keunggulan produk).
    const rawBubbles = clean
        .split(/\n{2,}/)
        .map(part => part.trim())
        .filter(Boolean);

    // HARD CAP: Maksimal 2 bubble per respons untuk mencegah spam.
    // CS manusia hanya balas 1-2 bubble per giliran, bot harus sama.
    const MAX_BUBBLES = 2;
    if (rawBubbles.length <= MAX_BUBBLES) {
        return rawBubbles;
    }
    // Gabungkan bubble ke-3 dan seterusnya menjadi satu bubble akhir
    const merged = [
        ...rawBubbles.slice(0, MAX_BUBBLES - 1),
        rawBubbles.slice(MAX_BUBBLES - 1).join('\n')
    ];
    return merged;
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

async function getAIResponse(userMessage, history = [], store = null, agent = null, customerMediaContext = "", conversationSummary = "", interactionCount = 1, customerPhone = "") {
    return new Promise((resolve, reject) => {
        pendingQueue.push({
            resolve,
            reject,
            queuedAt: Date.now(),
            execute: () => _processAIResponse(userMessage, history, store, agent, customerMediaContext, conversationSummary, interactionCount, customerPhone)
        });
        runNextInQueue();
    }).catch(err => {
        // Safety net: jika queue gagal, kembalikan fallback (server TIDAK BOLEH mati)
        logger.error(`[AI] Fallback response triggered: ${err.message}`);
        return { type: RESPONSE_TYPE.TEXT, content: ERRORS.AI_FALLBACK };
    });
}

/**
 * Inspector Agent — Deterministic Validation Gate
 * Support 3 schema produk: DTF | UV | BTS
 */
async function _runInspectorValidation(content, kind) {
    if (!content) return { valid: true };

    const RECAP_PATTERN = /rekap\s+pesanan|nama\s+cetak\s*:|total\s+pesanan\s*:|metode\s+pembayaran\s*:/i;
    if (!RECAP_PATTERN.test(content)) return { valid: true };

    const modelName = config.MODEL_NAME || 'gpt-4o-mini';

    const PRODUCT_SCHEMAS = {
        dtf: [
            'Nama Cetak (minimal 1 nama, bukan placeholder)',
            'Varian DTF (Varian 1/2/3/4 atau deskripsi varian)',
            'Warna DTF (Pink/Kuning/Putih/Hijau/Biru/Hitam)',
            'Jumlah paket (angka, bukan placeholder)',
            'Alamat lengkap (minimal Kecamatan dan Kota/Kabupaten)',
            'Ongkir (nominal Rp, bukan placeholder)',
            'Total pesanan (nominal Rp, bukan placeholder)',
            'Metode pembayaran (Transfer/COD, bukan UNKNOWN)',
        ],
        uv: [
            'Nama Cetak (minimal 1 nama, bukan placeholder)',
            'Varian UV (Cowok/Cewek/Polos — JANGAN tanya warna, UV tidak punya pilihan warna)',
            'Jumlah paket (angka, bukan placeholder)',
            'Alamat lengkap (minimal Kecamatan dan Kota/Kabupaten)',
            'Ongkir (nominal Rp, bukan placeholder)',
            'Total pesanan (nominal Rp, bukan placeholder)',
            'Metode pembayaran (Transfer/COD, bukan UNKNOWN)',
        ],
        bts: [
            'Nama Cetak (minimal 1 nama, semua komponen pakai nama yang sama)',
            'Desain Stiker Buku',
            'Desain Stiker Alat Tulis',
            'Desain Stiker Tempat Makan',
            'Varian bonus DTF (Varian 1/2/3/4)',
            'Warna bonus DTF (Pink/Kuning/Putih/Hijau/Biru/Hitam)',
            'Jumlah bundle (angka)',
            'Alamat lengkap (minimal Kecamatan dan Kota/Kabupaten)',
            'Ongkir awal dan subsidi ongkir BTS (maks Rp20.000)',
            'Total pesanan (nominal Rp)',
            'Metode pembayaran (Transfer/COD)',
        ],
        generic: [
            'Nama Cetak atau identitas produk (minimal terisi)',
            'Jumlah (angka)',
            'Alamat lengkap (minimal Kecamatan dan Kota)',
            'Total pesanan (nominal Rp)',
        ],
    };

    const schema = PRODUCT_SCHEMAS[kind] || PRODUCT_SCHEMAS.generic;
    const schemaText = schema.map((s, i) => `${i + 1}. ${s}`).join('\n');

    try {
        const inspectorResponse = await openai.chat.completions.create({
            model: modelName,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: [
                        'Kamu adalah Inspector Agent (Quality Control).',
                        'Tugasmu: Periksa apakah form Rekap Pesanan berikut sudah LENGKAP sesuai schema wajib.',
                        '',
                        `Tipe Produk: ${kind.toUpperCase()}`,
                        'Field yang WAJIB ada dan terisi (bukan placeholder, bukan kosong, bukan "[...]"):',
                        schemaText,
                        '',
                        'ATURAN KEPUTUSAN:',
                        '- valid: true  → Semua field wajib terisi dengan data nyata, tanpa placeholder.',
                        '- valid: false → Ada 1 atau lebih field yang kosong, berisi placeholder [...], atau data tidak masuk akal.',
                        '',
                        'Kembalikan HANYA JSON: { "valid": true/false, "missing": "Daftar field yang kurang, pisahkan koma" }',
                        'Jika valid=true, missing boleh dikosongkan.',
                    ].join('\n'),
                },
                {
                    role: 'user',
                    content: `Isi Rekap untuk dicek:\n\n${content}`,
                },
            ],
            temperature: 0.0,
            max_tokens: 200,
        });
        const raw = inspectorResponse.choices[0].message.content;
        const result = JSON.parse(raw);
        return { valid: result.valid !== false, missing: result.missing || '' };
    } catch (err) {
        logger.error(`[Inspector] Validation error (non-fatal): ${err.message}`);
        return { valid: true };
    }
}


/**
 * Logika internal pemrosesan AI (Refactored: Smarter & Safer)
 */
async function _processAIResponse(userMessage, history = [], store = null, agent = null, customerMediaContext = "", conversationSummary = "", interactionCount = 1, customerPhone = "", isRetry = false) {
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

        // ── Media Load ───────────────────────────────────────────────────────
        const knowledgeMedia = agentId ? await getKnowledgeMedia(agentId) : [];
        const sendableMedia  = agentId ? await getSendableMedia(agentId) : [];

        // Deteksi jenis produk agent (dtf/uv/bts/generic)
        const kind = inferAgentProductKind(agent, sendableMedia.map(m => ({ media: m })));

        // ── LEARNING BOT: Pola sukses dari closing nyata ─────────────────────
        let learningSection = '';
        try {
            learningSection = await buildLearningPromptSection(agentId, kind);
        } catch (_learningErr) {
            // Non-critical — jangan sampai fail prompt karena learning service error
        }

        // ── TIMESTAMP AWARENESS ──────────────────────────────────────────────
        const nowStr = moment().format('dddd, DD MMMM YYYY HH:mm');

        // ── Nomor WA Customer ────────────────────────────────────────────────
        const customerPhoneFormatted = customerPhone ? String(customerPhone).replace(/[^0-9+]/g, '') : '';
        const customerWADisplay = customerPhoneFormatted
            ? (customerPhoneFormatted.startsWith('+') ? customerPhoneFormatted : `+${customerPhoneFormatted}`)
            : '(belum tersedia)';

        // ── Media Knowledge Block ────────────────────────────────────────────
        const mediaKnowledgeBlock = knowledgeMedia.length > 0
            ? [
                `=== PENGETAHUAN VISUAL (${knowledgeMedia.length} item) ===`,
                knowledgeMedia.map(m => {
                    const icon = m.type?.startsWith('video') ? '🎬 VIDEO' : '📸 FOTO';
                    const parts = [`[${icon}]${m.label ? ` Topik: ${m.label}` : ''}`];
                    if (m.description)      parts.push(`  Deskripsi: ${m.description}`);
                    if (m.ai_analysis)      parts.push(`  Analisis Visual: ${m.ai_analysis}`);
                    if (m.video_transcript) parts.push(`  Narasi: "${m.video_transcript}"`);
                    return parts.join('\n');
                }).join('\n\n'),
              ].join('\n')
            : `=== PENGETAHUAN VISUAL === (belum ada media knowledge)`;

        // ── Catalog Block ────────────────────────────────────────────────────
        const catalogBlock = sendableMedia.length > 0
            ? [
                `=== KATALOG MEDIA YANG BISA DIKIRIM (${sendableMedia.length} item) ===`,
                `Gunakan tool "kirim_media_katalog" dengan ID atau label_names di bawah:`,
                sendableMedia.map(m =>
                    `  ID:${m.id} | Label:"${m.label || 'tanpa-label'}" | Tipe:${m.type}${m.description ? ` | ${m.description}` : ''}`
                ).join('\n'),
              ].join('\n')
            : `=== KATALOG MEDIA === (belum ada media yang bisa dikirim)`;

        // ── Label Block ──────────────────────────────────────────────────────
        const labelBlock = configuredLabels.length > 0
            ? `=== LABEL YANG TERSEDIA ===\n${configuredLabels.map(l => `  - ${l}`).join('\n')}`
            : `=== LABEL === (belum dikonfigurasi untuk agen ini)`;

        // ── Learning Block ───────────────────────────────────────────────────
        const learningBlock = learningSection
            ? `=== POLA SUKSES CLOSING (dari data nyata) ===\n${learningSection}`
            : '';

        // ── Conversation State Block ─────────────────────────────────────────
        const conversationBlock = interactionCount === 1
            ? [
                `=== STATUS: INTERAKSI PERTAMA ===`,
                `Prioritas: Jika customer belum tahu produk, panggil tool kirim_media_katalog sekarang untuk mengirim katalog/video produk.`,
                `Namun jika customer sudah jelas tahu apa yang mau dibeli, langsung sambut dan tanyakan data yang dibutuhkan.`,
              ].join('\n')
            : [
                `=== STATUS: INTERAKSI KE-${interactionCount} ===`,
                `=== REKAP PEMBAHASAN SEBELUMNYA (Long-Term Memory) ===`,
                conversationSummary || 'Percakapan sedang berlangsung.',
                ``,
                `PENTING: Data yang sudah dikumpulkan di atas JANGAN ditanyakan ulang.`,
                `Jika customer tanya katalog/varian → panggil kirim_media_katalog.`,
              ].join('\n');

        // ── Technical Rules Block (immutable) ───────────────────────────────
        const technicalRulesBlock = [
            `=== ATURAN TEKNIS SISTEM (MUTLAK, TIDAK BOLEH DILANGGAR) ===`,
            `WAKTU SISTEM: ${nowStr} (HANYA untuk sapaan internal. DILARANG tulis di balasan.)`,
            `No WA Customer: ${customerWADisplay} (GUNAKAN untuk field No WA di rekap. DILARANG placeholder.)`,
            `1. DILARANG menulis karakter ![...](...), URL http://, atau link fiktif apapun.`,
            `2. DILARANG menulis ID media, timestamp teknis, atau info sistem di teks balasan.`,
            `3. DILARANG menulis catatan internal seperti "(Kirim gambar...)", "[SISTEM:...]" — sistem kirim otomatis.`,
            `4. DILARANG mengakhiri setiap pesan dengan pertanyaan jika proses sudah selesai.`,
            `5. DILARANG menandai Closing Transfer sebelum bukti pembayaran diterima dan valid.`,
            `6. DILARANG menandai Closing COD sebelum rekap dikonfirmasi customer.`,
            `7. DILARANG menyebut COD di opening atau sebelum customer membahas COD.`,
            `8. DILARANG mengarang data customer (nama, alamat, nomor, ongkir, dll).`,
            `9. DILARANG membuat lebih dari 2 bubble per respons — rekap adalah pengecualian satu-satunya.`,
            `10. Label HANYA boleh ditambahkan via tool tambahkan_label_chat dengan label yang tersedia.`,
            `11. matikan_bot_kontak HANYA untuk kasus di luar kemampuan bot. JANGAN matikan setelah Closing.`,
            `12. DILARANG memberikan dua diskon ongkir sekaligus.`,
        ].join('\n');

        // ── Agent Prompt dari DB (product-specific knowledge) ────────────────
        const agentPromptBlock = [
            `=== IDENTITAS, PRODUK, DAN INSTRUKSI AGENT (PRIORITAS TERTINGGI) ===`,
            `Instruksi berikut MENGGANTIKAN segala aturan teknis di atas jika bertentangan.`,
            ``,
            sysPrompt,
            ``,
            `=== INFORMASI PRODUK & KNOWLEDGE BASE ===`,
            knowledge,
        ].join('\n');

        // ── Assembly: gabungkan semua blok ───────────────────────────────────
        const fullSystemInstruction = [
            mediaKnowledgeBlock,
            catalogBlock,
            labelBlock,
            learningBlock,
            conversationBlock,
            technicalRulesBlock,
            agentPromptBlock,
        ].filter(Boolean).join('\n\n');

        // === TOOL DEFINITIONS ===
        const tools = [
            {
                type: "function",
                function: {
                    name: "cek_ongkir",
                    description: "Mengecek biaya ongkos kirim J&T dari Kediri ke kota tujuan di Indonesia.",
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
            },
            // ── TOOL UTAMA: Buat Order Scalev + QRIS Dinamis ──
            // Flow: createOrderAndPay → order di Scalev → QRIS PNG → kirim ke WA
            {
                type: "function",
                function: {
                    name: "buat_order_scalev",
                    description: `Membuat order di Scalev dan QRIS dinamis untuk customer yang memilih Transfer atau DP, lalu mengirim gambar QRIS langsung ke WhatsApp customer.

KAPAN PANGGIL: Hanya jika customer SUDAH konfirmasi memilih Transfer/NON-COD atau bersedia DP.
JANGAN PANGGIL jika:
- Customer pilih COD murni
- Customer belum konfirmasi rekap dengan kata 'iya' atau sejenisnya
- Nominal belum jelas dari rekap yang sudah dikonfirmasi

SETELAH TOOL DIPANGGIL:
- Order dicatat di dashboard Scalev secara otomatis
- Gambar QRIS dikirim otomatis oleh sistem ke WhatsApp customer
- Kamu hanya perlu menginformasikan dengan ramah: "Bunda, gambar pembayaran sudah kami kirim ya, tinggal scan dari m-banking 😊 Kalau lebih nyaman transfer biasa ke Mandiri/BCA juga bisa kok."
- Jangan menyebut nama platform ke customer — cukup bilang "QRIS" atau "gambar pembayaran"

NOMINAL: WAJIB persis sama dengan rekap. DP = 50% dari Total Harus Dibayar. Lunas = Total Harus Dibayar. DILARANG mengarang nominal.`,
                    parameters: {
                        type: "object",
                        properties: {
                            customer_name: {
                                type: "string",
                                description: "Nama customer persis seperti di rekap pesanan."
                            },
                            customer_phone: {
                                type: "string",
                                description: "Nomor HP customer (format internasional misal: 6281234567890). Ambil dari conversation context."
                            },
                            address: {
                                type: "string",
                                description: "Alamat lengkap customer dari rekap pesanan."
                            },
                            amount: {
                                type: "integer",
                                description: "Nominal dalam Rupiah (bilangan bulat). WAJIB diambil dari rekap: untuk DP = 50% dari Total Harus Dibayar; untuk Lunas = Total Harus Dibayar. JANGAN karang nominal sendiri."
                            },
                            description: {
                                type: "string",
                                description: "Deskripsi singkat pesanan. Contoh: 'Label DTF 30pcs - Bunda Sari' atau 'UV Stiker - Bunda Rini'"
                            },
                            tipe_bayar: {
                                type: "string",
                                enum: ["DP", "LUNAS"],
                                description: "Tipe pembayaran: DP (bayar sebagian/down payment) atau LUNAS (bayar penuh)."
                            },
                            shipping_cost: {
                                type: "integer",
                                description: "Ongkos kirim dalam Rupiah dari rekap pesanan (opsional)."
                            },
                            contact_id: {
                                type: "string",
                                description: "WAJIB: ID kontak WhatsApp customer (format: 62812345678 atau 62812345678@c.us)."
                            },
                            store_wa_id: {
                                type: "string",
                                description: "WAJIB: ID store WhatsApp bot yang sedang dipakai."
                            },
                            ordervariants: {
                                type: "array",
                                description: "Detail produk yang dipesan (opsional tapi SANGAT DISARANKAN untuk rekap di Scalev). Isi sesuai rekap pesanan.",
                                items: {
                                    type: "object",
                                    properties: {
                                        product_name: { type: "string", description: "Nama produk. Contoh: 'Label Nama DTF', 'Stiker UV DTF', 'Paket Bundling BTS'" },
                                        variant_name: { type: "string", description: "Varian yang dipilih customer. Contoh: 'Varian 2 - Pink', 'Varian Cewek'" },
                                        quantity: { type: "integer", description: "Jumlah paket yang dipesan (angka)." },
                                        price: { type: "integer", description: "Harga per paket dalam Rupiah. Contoh: 39000" }
                                    }
                                }
                            }
                        },
                        required: ["customer_name", "amount", "description", "tipe_bayar", "contact_id", "store_wa_id"]
                    }
                }
            }
        ]; // ← penutup array tools

        // ── TOOL: Buat Resi Mengantar (setelah customer bayar) ──
        // Hanya tampilkan tool ini jika MENGANTAR_API_KEY dikonfigurasi
        if (process.env.MENGANTAR_API_KEY) {
            tools.push({
                type: "function",
                function: {
                    name: "buat_resi_mengantar",
                    description: `Membuat nomor resi/AWB di Mengantar untuk pesanan yang SUDAH LUNAS/TERBAYAR.

KAPAN PANGGIL:
- Hanya SETELAH pembayaran customer dikonfirmasi (bukti transfer valid, atau webhook Scalev paid)
- Saat owner/admin meminta buat resi untuk pesanan tertentu
- JANGAN panggil sebelum ada konfirmasi pembayaran

SETELAH TOOL DIPANGGIL:
- Sistem otomatis kirim notif ke customer dengan nomor resi
- Kamu cukup ucapkan terima kasih dan info bahwa paket sedang diproses

CATATAN: Gunakan data dari rekap pesanan. Isi semua field seakurat mungkin.`,
                    parameters: {
                        type: "object",
                        properties: {
                            customer_name: {
                                type: "string",
                                description: "Nama penerima (sesuai rekap pesanan)"
                            },
                            customer_phone: {
                                type: "string",
                                description: "Nomor HP penerima (format: 081234567890 atau 6281234567890)"
                            },
                            customer_address: {
                                type: "string",
                                description: "Alamat lengkap penerima dari rekap pesanan"
                            },
                            destination_keyword: {
                                type: "string",
                                description: "Nama Kecamatan dan Kota/Kabupaten tujuan untuk lookup ID. Contoh: 'Loceret, Nganjuk' atau 'Mojoroto, Kediri'"
                            },
                            parcel_content: {
                                type: "string",
                                description: "Isi paket / nama produk. Contoh: 'Label Nama DTF 30pcs'"
                            },
                            weight: {
                                type: "number",
                                description: "Berat paket dalam kg (default 1)"
                            },
                            quantity: {
                                type: "integer",
                                description: "Jumlah item (default 1)"
                            },
                            goods_value: {
                                type: "integer",
                                description: "Nilai barang dalam Rupiah (untuk asuransi). Ambil dari total pesanan di rekap."
                            },
                            courier: {
                                type: "string",
                                enum: ["JT", "JNE", "Sap", "SiCepat", "Ninja", "iDexpress", "lion", "anteraja"],
                                description: "Kurir pengiriman (default: JT). Pilih sesuai preferensi atau ketersediaan."
                            },
                            contact_id: {
                                type: "string",
                                description: "ID kontak WhatsApp customer untuk kirim notif resi"
                            },
                            store_wa_id: {
                                type: "string",
                                description: "ID store WA bot yang dipakai"
                            },
                            custom_products: {
                                type: "array",
                                description: "Detail produk (opsional, untuk label cetak di resi Mengantar)",
                                items: {
                                    type: "object",
                                    properties: {
                                        name: { type: "string", description: "Nama produk" },
                                        variant: { type: "string", description: "Varian produk" },
                                        qty: { type: "integer", description: "Jumlah" },
                                        price: { type: "integer", description: "Harga satuan (Rp)" }
                                    }
                                }
                            }
                        },
                        required: ["customer_name", "customer_address", "destination_keyword", "parcel_content", "contact_id", "store_wa_id"]
                    }
                }
            });
        }

        if (configuredLabels.length > 0) {
            tools.push({
                type: "function",
                function: {
                    name: "tambahkan_label_chat",
                    description: "Menambahkan label khusus ke kontak WhatsApp pelanggan. Gunakan HANYA label yang tersedia dari konfigurasi agen.",
                    parameters: {
                        type: "object",
                        properties: {
                            label_names: {
                                type: "array",
                                items: {
                                    type: "string",
                                    enum: configuredLabels
                                },
                                description: "Daftar nama label persis dari konfigurasi agen (bisa lebih dari satu)."
                            }
                        },
                        required: ["label_names"]
                    }
                }
            });
        }

        // ══════════════════════════════════════════════════════════════════
        // BUILD MESSAGES
        // ══════════════════════════════════════════════════════════════════
        let userContent = userMessage;
        if (customerMediaContext) {
            userContent = `[SISTEM: Pelanggan baru saja mengirim MEDIA/FOTO. Berikut adalah deskripsi visualnya untuk panduanmu: ${customerMediaContext}]\n\nPESAN PELANGGAN: ${userMessage || '(Hanya mengirim foto)'}`;
        }

        const filteredHistory = history.length > 0 
            ? history.slice(0, history.length - 1) 
            : [];

        // Build structured customer data from conversation summary (anti-lupa)
        // NOTE: Conversation summary sekarang di-handle oleh conversationBlock di fullSystemInstruction.

        let messages = [
            { role: 'system', content: fullSystemInstruction },
            ...filteredHistory.map(h => {
                if (h.is_from_me) {
                    return {
                        role: 'assistant',
                        content: h.body || h.content || ''
                    };
                } else {
                    const dayStr = h.timestamp ? moment(h.timestamp).format('DD MMM HH:mm') : '';
                    return {
                        role: 'user',
                        content: dayStr ? `(Dikirim ${dayStr})\n${h.body || h.content || ''}` : (h.body || h.content || '')
                    };
                }
            }),
            { role: 'user', content: userContent }
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

        // ══════════════════════════════════════════════════════════════════
        // 🔧 AUTO-INJECT MEDIA SAFETY NET
        // Jika AI menulis teks yang mereferensikan video/foto/katalog TANPA
        // memanggil tool, sistem otomatis deteksi & inject media yang relevan.
        // Mencegah "ghost media" — bot bilang "cek videonya" tapi tidak kirim.
        // ══════════════════════════════════════════════════════════════════
        if ((!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) && responseMessage.content) {
            const autoMedia = _autoInjectMedia(responseMessage.content, kind, sendableMedia);
            if (autoMedia && autoMedia.length > 0) {
                logger.warn(`[AI] 🔧 Ghost-media dicegah! AI menyebut media dalam teks tanpa call tool. Auto-inject: ${autoMedia.map(m => m.label).join(', ')}`);
                return {
                    type: RESPONSE_TYPE.MEDIA,
                    content: sanitizeTextOutput(responseMessage.content),
                    mediaList: autoMedia.map(m => ({ media: m, caption: '' })),
                    tool_calls: []
                };
            }
        }

        // === TOOL CALLING HANDLER ===
        if (responseMessage.tool_calls) {
            // 🛡️ PRE-TOOL INSPECTOR MIDDLEWARE
            // Cegah AI mengeksekusi tool (seperti pembuat QRIS) jika rekapnya belum valid!
            if (!isRetry && responseMessage.content) {
                const inspectorResult = await _runInspectorValidation(responseMessage.content, kind);
                if (!inspectorResult.valid) {
                    logger.warn(`[Inspector] Rekap ditolak (PRE-TOOL): ${inspectorResult.missing}. Retrying...`);
                    const retryHistory = [...history];
                    retryHistory.push({ role: 'assistant', content: responseMessage.content, is_from_me: true });
                    retryHistory.push({ 
                        role: 'user', 
                        content: `[SISTEM INSPECTOR]: Draf rekap DITOLAK karena data kurang: ${inspectorResult.missing}. Tanyakan kekurangan data ini ke pelanggan dengan bahasa natural. JANGAN memanggil tool buat_order_scalev sebelum rekap lengkap!` 
                    });
                    return _processAIResponse("", retryHistory, store, agent, customerMediaContext, conversationSummary, interactionCount, customerPhone, true);
                }
            }

            messages.push(responseMessage);
            let mediaResults = [];
            let needsSecondCall = false;

            for (const toolCall of responseMessage.tool_calls) {
                try {
                    if (toolCall.function.name === 'cek_ongkir') {
                        const args = JSON.parse(toolCall.function.arguments);
                        const ongkirResult = await mengantarService.getShippingCost(args.destinationCity, args.weightGrams || 1000);
                        messages.push({ tool_call_id: toolCall.id, role: "tool", name: "cek_ongkir", content: ongkirResult });
                        needsSecondCall = true;
                    }

                    if (toolCall.function.name === 'tambahkan_label_chat') {
                        const args = JSON.parse(toolCall.function.arguments);
                        messages.push({ tool_call_id: toolCall.id, role: "tool", name: "tambahkan_label_chat", content: `Label '${args.label_names.join(', ')}' diteruskan ke sistem.` });
                        // Execution of the actual label happens downstream (in message_handler)
                        needsSecondCall = true;
                    }

                    if (toolCall.function.name === 'matikan_bot_kontak') {
                        const args = JSON.parse(toolCall.function.arguments || '{}');
                        messages.push({ tool_call_id: toolCall.id, role: "tool", name: "matikan_bot_kontak", content: `Bot akan dipause untuk kontak ini. Alasan: ${args.reason || 'perlu CS manusia'}` });
                        needsSecondCall = true;
                    }

                    // ── TOOL UTAMA: Buat Order Scalev + QRIS Dinamis ──
                    // Flow: createOrderAndPay → Scalev API → QRIS PNG → kirim ke WA customer
                    if (toolCall.function.name === 'buat_order_scalev') {
                        try {
                            const args = JSON.parse(toolCall.function.arguments || '{}');
                            const customerName = String(args.customer_name || '').trim();
                            const amount = Math.round(Number(args.amount));
                            const desc = String(args.description || 'Pembayaran Pesanan').trim();
                            const tipeBayar = (args.tipe_bayar === 'LUNAS' ? 'LUNAS' : 'DP');
                            const explicitContactId = args.contact_id || null;
                            const contactId = explicitContactId || customerPhone || null;
                            const explicitStoreWaId = args.store_wa_id || null;
                            const storeWaId = explicitStoreWaId || store?.wa_id || null;

                            // ── Guard 1: nominal harus valid ──
                            if (!amount || amount <= 0) {
                                messages.push({
                                    tool_call_id: toolCall.id, role: 'tool',
                                    name: 'buat_order_scalev',
                                    content: 'Gagal: Nominal tidak valid. Ambil nominal dari rekap pesanan yang sudah dikonfirmasi customer.'
                                });
                                needsSecondCall = true;
                                continue;
                            }
                            if (!customerName) {
                                messages.push({
                                    tool_call_id: toolCall.id, role: 'tool',
                                    name: 'buat_order_scalev',
                                    content: 'Gagal: customer_name harus diisi. Ambil dari rekap pesanan.'
                                });
                                needsSecondCall = true;
                                continue;
                            }

                            // ── Guard 2: Dihapus (Auto-QRIS: Tidak perlu menunggu IYA karena sudah dilindungi Pre-Tool Inspector) ──

                            // ── Panggil Scalev API ──
                            const scalevSvc = getScalevService();
                            let scalevResult = null;

                            if (scalevSvc && process.env.SCALEV_API_KEY) {
                                try {
                                    scalevResult = await scalevSvc.createOrderAndPay({
                                        store_unique_id: process.env.SCALEV_STORE_UNIQUE_ID || '',
                                        customer_name: customerName,
                                        customer_phone: args.customer_phone || (contactId ? contactId.replace('@c.us', '') : undefined),
                                        address: args.address || undefined,
                                        shipping_cost: args.shipping_cost ? Math.round(Number(args.shipping_cost)) : undefined,
                                        payment_method: 'qris',
                                        // amount = nominal tagihan (dipakai scalev_service untuk dynamic pricing)
                                        amount: amount,
                                        notes: `[${tipeBayar}] ${desc} | Customer: ${customerName}`,
                                        // ordervariants: rincian pesanan asli — dimasukkan ke notes di scalev_service
                                        ordervariants: (args.ordervariants && args.ordervariants.length > 0)
                                            ? args.ordervariants.map(v => ({
                                                product_name: v.product_name || 'Produk',
                                                variant_name: v.variant_name || '',
                                                quantity: Math.round(Number(v.quantity) || 1),
                                                price: Math.round(Number(v.price) || 0),
                                            }))
                                            : undefined,
                                        metadata: {
                                            tipe_bayar: tipeBayar,
                                            contact_id: contactId || '',
                                            store_wa_id: storeWaId || '',
                                            created_by: 'bot_ai_legacy',
                                            description: desc,
                                            amount: amount,
                                        },
                                        agent_context: { source: 'crm_ai_bot_legacy', tipe_bayar: tipeBayar },
                                    });
                                } catch (scalevErr) {
                                    logger.warn(`[AI-Legacy] Scalev error: ${scalevErr.message}`);
                                }
                            } else {
                                logger.warn('[AI-Legacy] SCALEV_API_KEY belum dikonfigurasi di .env');
                            }

                            // ── Sukses QRIS via Scalev ──
                            if (scalevResult && scalevResult.success && scalevResult.qrisImageBuffer) {
                                // Kirim gambar QRIS ke WA customer
                                if (storeWaId && contactId) {
                                    try {
                                        const waSvc = require('./whatsapp_service');
                                        const { MessageMedia } = require('whatsapp-web.js');
                                        const clients = waSvc.getClients ? waSvc.getClients() : null;
                                        const client = clients ? clients.get(storeWaId) : null;
                                        if (client) {
                                            const media = new MessageMedia('image/png', scalevResult.qrisImageBuffer.toString('base64'), 'qris_payment.png');
                                            const caption = [
                                                `Ini QRIS pembayarannya ya bund 😊`,
                                                `Nominal: *Rp ${amount.toLocaleString('id-ID')}* [${tipeBayar}]`,
                                                `Tinggal scan dari m-banking bund, berlaku 30 menit ya 🙏`,
                                                ``,
                                                `🏦 Atau transfer manual ke rekening kami ya bund 🙏`,
                                            ].join('\n');
                                            const waId = contactId.includes('@c.us') ? contactId : `${contactId}@c.us`;
                                            await client.sendMessage(waId, media, { caption });
                                            logger.info(`[AI-Legacy] ✅ QRIS PNG (Scalev) terkirim ke ${contactId}`);
                                        } else {
                                            logger.warn(`[AI-Legacy] WA client tidak ditemukan untuk store: ${storeWaId}`);
                                        }
                                    } catch (waErr) {
                                        logger.error(`[AI-Legacy] Gagal kirim QRIS PNG ke WA: ${waErr.message}`);
                                    }
                                }
                                messages.push({
                                    tool_call_id: toolCall.id, role: 'tool', name: 'buat_order_scalev',
                                    content: [
                                        `Order berhasil dibuat di Scalev (Order ID: ${scalevResult.order_id}).`,
                                        `QRIS berhasil dibuat dan sudah dikirim ke customer sebagai gambar.`,
                                        `Nominal: Rp ${amount.toLocaleString('id-ID')} [${tipeBayar}]. Berlaku 30 menit.`,
                                        scalevResult.public_order_url ? `Link order: ${scalevResult.public_order_url}` : '',
                                        `Instruksi: Sampaikan gambar QRIS sudah dikirim, tinggal scan dari m-banking.`,
                                        `Juga ingatkan backup transfer ke rekening toko (dari product knowledge).`,
                                    ].filter(Boolean).join(' ')
                                });
                                logger.info(`[AI-Legacy] ✅ Scalev order+QRIS: ${scalevResult.order_id} Rp ${amount} [${tipeBayar}]`);

                            } else if (scalevResult && scalevResult.success && scalevResult.payment_url) {
                                // Ada payment URL tapi tidak ada QRIS image
                                messages.push({
                                    tool_call_id: toolCall.id, role: 'tool', name: 'buat_order_scalev',
                                    content: [
                                        `Order berhasil (ID: ${scalevResult.order_id}).`,
                                        `Link pembayaran: ${scalevResult.payment_url}`,
                                        `Kirimkan link ini ke customer: ${scalevResult.payment_url}`,
                                    ].join(' ')
                                });

                            } else {
                                // Gagal → fallback instruksi transfer manual
                                const errMsg = scalevResult ? scalevResult.error : 'Scalev API key belum dikonfigurasi';
                                logger.warn(`[AI-Legacy] Scalev gagal (${errMsg}), fallback ke transfer manual. Rp ${amount}`);
                                messages.push({
                                    tool_call_id: toolCall.id, role: 'tool', name: 'buat_order_scalev',
                                    content: [
                                        `Sistem QRIS sementara tidak tersedia (${errMsg}).`,
                                        `Minta customer transfer manual ke rekening toko.`,
                                        `Nominal: Rp ${amount.toLocaleString('id-ID')} [${tipeBayar}].`,
                                        `Rekening: ambil dari product knowledge. Sampaikan dengan ramah.`,
                                    ].join(' ')
                                });
                            }
                            needsSecondCall = true;
                        } catch (scalevToolErr) {
                            logger.error(`[AI-Legacy] buat_order_scalev error: ${scalevToolErr.message}`);
                            messages.push({
                                tool_call_id: toolCall.id, role: 'tool', name: 'buat_order_scalev',
                                content: 'Sistem pembayaran tidak tersedia. Minta customer transfer manual ke rekening toko. Sampaikan dengan ramah.'
                            });
                            needsSecondCall = true;
                        }
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
                        const allowedMedia = [];

                        // 1. Eksekusi via ID
                        if (ids.length > 0) {
                            allowedMedia.push(...sendableMedia.filter(m => ids.includes(m.id)));
                        }

                        // 2. Eksekusi via Label Names
                        if (labels.length > 0) {
                            for (const qLbl of labels) {
                                const qLower = qLbl.toLowerCase().trim();
                                
                                // Kumpulkan semua media yang match
                                const matchesForLabel = sendableMedia.filter(m => {
                                    if (!m.label) return false;
                                    const mLbl = m.label.toLowerCase().trim();
                                    return mLbl === qLower || mLbl.includes(qLower) || qLower.includes(mLbl);
                                });

                                const videos = matchesForLabel.filter(m => (m.type || '').startsWith('video'));
                                const images = matchesForLabel.filter(m => (m.type || '').startsWith('image'));

                                // Inject 1 RANDOM foto/image jika ada lebih dari 1 (Fix Media Spam)
                                if (images.length > 0) {
                                    const randomImage = images[Math.floor(Math.random() * images.length)];
                                    if (!allowedMedia.find(fm => fm.id === randomImage.id)) {
                                        allowedMedia.push(randomImage);
                                    }
                                }

                                // Pilih 1 video SECARA RANDOM
                                if (videos.length > 0) {
                                    const randomVideo = videos[Math.floor(Math.random() * videos.length)];
                                    if (!allowedMedia.find(fm => fm.id === randomVideo.id)) {
                                        allowedMedia.push(randomVideo);
                                    }
                                }
                            }
                        }

                        if (allowedMedia.length > 0) {
                            mediaResults.push(...allowedMedia.map((m, idx) => ({ media: m, caption: idx === 0 ? (args.caption || "") : "" })));
                            messages.push({ tool_call_id: toolCall.id, role: "tool", name: "kirim_media_katalog", content: `${allowedMedia.length} media berhasil dikirim.` });
                            needsSecondCall = true;
                        } else {
                            const availableLabels = sendableMedia.map(m => m.label).filter(Boolean).join(', ');
                            messages.push({ tool_call_id: toolCall.id, role: "tool", name: "kirim_media_katalog", content: `Media tidak ditemukan untuk label: ${labels.join(', ')}. Label yang tersedia: ${availableLabels || '(kosong, belum ada media)'}` });
                            needsSecondCall = true;
                        }
                    }
                    // ── TOOL: Buat Resi Mengantar ──
                    if (toolCall.function.name === 'buat_resi_mengantar') {
                        try {
                            const args = JSON.parse(toolCall.function.arguments || '{}');
                            const explicitContactId = args.contact_id || null;
                            const contactId = explicitContactId || customerPhone || null;
                            const explicitStoreWaId = args.store_wa_id || null;
                            const storeWaId = explicitStoreWaId || store?.wa_id || null;

                            // Validasi dasar
                            if (!args.customer_name || !args.customer_address || !args.destination_keyword || !args.parcel_content) {
                                messages.push({
                                    tool_call_id: toolCall.id, role: 'tool', name: 'buat_resi_mengantar',
                                    content: 'Gagal: Data tidak lengkap. Pastikan nama, alamat, kecamatan/kota, dan nama produk sudah diisi.'
                                });
                                needsSecondCall = true;
                                continue;
                            }

                            logger.info(`[AI-Legacy] Membuat resi Mengantar untuk ${args.customer_name}...`);
                            const resiResult = await mengantarService.createOrder({
                                customerName: args.customer_name,
                                customerPhone: args.customer_phone || (contactId ? contactId.replace('@c.us', '') : ''),
                                customerAddress: args.customer_address,
                                destinationKeyword: args.destination_keyword,
                                parcelContent: args.parcel_content,
                                weight: args.weight || 1,
                                quantity: args.quantity || 1,
                                goodsValue: args.goods_value,
                                courier: args.courier,
                                customProducts: args.custom_products,
                                pickupType: 'dropOff',
                            });

                            if (resiResult.success) {
                                // Kirim notif resi ke WA customer
                                if (storeWaId && contactId) {
                                    try {
                                        const waSvc = require('./whatsapp_service');
                                        const clients = waSvc.getClients ? waSvc.getClients() : null;
                                        const waClient = clients ? clients.get(storeWaId) : null;
                                        if (waClient) {
                                            const resiMsg = mengantarService.formatResiMessage(resiResult);
                                            const waId = contactId.includes('@c.us') ? contactId : `${contactId}@c.us`;
                                            await waClient.sendMessage(waId, resiMsg);
                                            logger.info(`[AI-Legacy] ✅ Notif resi terkirim ke ${contactId}`);
                                        }
                                    } catch (waErr) {
                                        logger.error(`[AI-Legacy] Gagal kirim notif resi ke WA: ${waErr.message}`);
                                    }
                                }

                                messages.push({
                                    tool_call_id: toolCall.id, role: 'tool', name: 'buat_resi_mengantar',
                                    content: [
                                        `Resi berhasil dibuat di Mengantar!`,
                                        resiResult.cnote_no ? `Nomor Resi: ${resiResult.cnote_no}` : '',
                                        `Kurir: ${resiResult.courier || 'JT'}`,
                                        resiResult.destination ? `Tujuan: ${resiResult.destination}` : '',
                                        resiResult.is_unpaid ? `PERHATIAN: Saldo Mengantar kurang, resi perlu diaktivasi manual.` : `Status: Aktif & terbayar.`,
                                        `Notif resi sudah dikirim ke customer via WhatsApp.`,
                                        `Instruksi: Ucapkan terima kasih dan info paket sedang diproses.`,
                                    ].filter(Boolean).join(' ')
                                });
                                logger.info(`[AI-Legacy] ✅ Resi Mengantar: ${resiResult.cnote_no} untuk ${args.customer_name}`);
                            } else {
                                messages.push({
                                    tool_call_id: toolCall.id, role: 'tool', name: 'buat_resi_mengantar',
                                    content: `Gagal membuat resi Mengantar: ${resiResult.error}. Minta owner untuk buat resi manual di aplikasi Mengantar.`
                                });
                                logger.warn(`[AI-Legacy] Resi Mengantar gagal: ${resiResult.error}`);
                            }
                            needsSecondCall = true;
                        } catch (resiErr) {
                            logger.error(`[AI-Legacy] buat_resi_mengantar error: ${resiErr.message}`);
                            messages.push({
                                tool_call_id: toolCall.id, role: 'tool', name: 'buat_resi_mengantar',
                                content: `Sistem Mengantar tidak tersedia saat ini. Buat resi manual di aplikasi Mengantar ya bund.`
                            });
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
            // Disable fast return media so AI always generates natural follow-up text after sending catalogs
            const canFastReturnMedia = false;
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
                finalContent = buildFastMediaReply(agent, interactionCount);
            }

            // ══════════════════════════════════════════════════════════════════
            // 🛡️ INSPECTOR MIDDLEWARE: Cegat Rekap Pesanan yang tidak lengkap
            // ══════════════════════════════════════════════════════════════════
            if (!isRetry && finalContent) {
                const inspectorResult = await _runInspectorValidation(finalContent, kind);
                if (!inspectorResult.valid) {
                    logger.warn(`[Inspector] Rekap ditolak: ${inspectorResult.missing}. Retrying...`);
                    // Buat history baru untuk menyuruh AI memperbaiki tanpa mengirim rekap
                    const retryHistory = [...history];
                    retryHistory.push({ role: 'assistant', body: finalContent, is_from_me: true });
                    retryHistory.push({ 
                        role: 'user', 
                        body: `[SISTEM INSPECTOR]: Draf rekap DITOLAK karena data kurang: ${inspectorResult.missing}. Tanyakan kekurangan data ini ke pelanggan dengan bahasa natural. JANGAN kirim form rekap ke pelanggan!` 
                    });
                    
                    // Recursive call exactly 1 time
                    return _processAIResponse("", retryHistory, store, agent, customerMediaContext, conversationSummary, interactionCount, customerPhone, true);
                }
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

        // 🛡️ INSPECTOR MIDDLEWARE untuk basic flow
        let basicContent = sanitizeTextOutput(responseMessage.content) || "Ada yang bisa saya bantu?";
        if (!isRetry && basicContent) {
            const inspectorResult = await _runInspectorValidation(basicContent, kind);
            if (!inspectorResult.valid) {
                logger.warn(`[Inspector] Rekap ditolak: ${inspectorResult.missing}. Retrying...`);
                const retryHistory = [...history];
                retryHistory.push({ role: 'assistant', body: basicContent, is_from_me: true });
                retryHistory.push({ 
                    role: 'user', 
                    body: `[SISTEM INSPECTOR]: Draf rekap DITOLAK karena data kurang: ${inspectorResult.missing}. Tanyakan kekurangan data ini ke pelanggan dengan bahasa natural. JANGAN kirim form rekap ke pelanggan!` 
                });
                return _processAIResponse("", retryHistory, store, agent, customerMediaContext, conversationSummary, interactionCount, customerPhone, true);
            }
        }

        return {
            type: RESPONSE_TYPE.TEXT,
            content: basicContent,
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
Ekstrak SEMUA informasi yang sudah disebutkan customer dari riwayat chat.
Gunakan format PERSIS seperti ini (isi setiap field, tulis "belum" jika belum diketahui):

NAMA CUSTOMER: [nama pemesan, atau "belum"]
PRODUK DIMINATI: [nama produk yang diminati customer, atau "belum jelas"]
VARIAN: [tulis varian yang dipilih customer persis seperti yang disebutkan. Tulis "N/A" jika produk tidak punya pilihan varian. Tulis "belum" jika belum dipilih]
WARNA: [tulis warna yang dipilih. Tulis "Sesuai desain varian" jika produk tidak punya pilihan warna. Tulis "belum" jika produk punya pilihan warna tapi belum dipilih]
TEKS LABEL: [nama-nama yang mau dicetak, tulis satu per satu, atau "belum"]
JUMLAH: [jumlah paket atau "belum"]
DETAIL PER NAMA: [contoh: "Andrian 30pcs, Alivia 30pcs" atau "belum"]
ALAMAT: [alamat lengkap atau "belum"]
HARGA: [sudah disebutkan / belum]
ONGKIR: [nominal aktual, contoh: "Rp 18.000" atau "belum dicek". JANGAN tulis hanya "sudah dicek".]
METODE BAYAR: [Transfer / COD / belum]
STATUS: [opening / gali kebutuhan / negosiasi / menunggu alamat / menunggu rekap / menunggu transfer / closing / selesai / cancel]
UPSELLING_TERKIRIM: [ya / tidak]
NEXT ACTION: [langkah selanjutnya yang perlu dilakukan]
WA_LABELS: [label paling relevan. Format array, contoh: [Closing] atau [COD, Closing]]
CATATAN: [info penting lain, keluhan, permintaan khusus]

ATURAN FIELD ONGKIR:
- Ada nominal Rp di chat → wajib tulis nominalnya
- Belum dicek → tulis "belum dicek"
- DILARANG tulis hanya "sudah dicek" tanpa nominal

ATURAN WA_LABELS:
- Opening/baru → [AI Lead Baru]
- Gali kebutuhan → [AI Lead Aktif]
- Data belum lengkap, belum direkap → [Menunggu Rekap]
- COD, belum konfirmasi deal → [COD]
- Transfer, belum ada bukti → [Menunggu Transfer]
- COD + sudah konfirmasi deal → [Closing, COD]
- Transfer + sudah kirim bukti → [Closing]
- Batal/tidak jadi → [Cancel]

ATURAN KRITIS — STATUS "closing" HANYA BOLEH DIISI JIKA SEMUA KONDISI BERIKUT TERPENUHI:
✅ NAMA CUSTOMER sudah ada (bukan "belum")
✅ ALAMAT sudah ada lengkap (bukan "belum" atau "-")
✅ TEKS LABEL sudah ada (bukan "belum")
✅ ONGKIR sudah ada nominal Rp (bukan "belum dicek")
✅ DETAIL PER NAMA sudah jelas
✅ METODE BAYAR sudah jelas (Transfer atau COD)
✅ REKAP sudah dikirim dan customer sudah konfirmasi
✅ VARIAN sudah terisi (bukan "belum"). Jika produk tidak punya varian, boleh "N/A".
✅ WARNA sudah terisi dengan nilai yang bermakna (bukan "belum", bukan kosong, bukan placeholder). Jika produk tidak punya warna, gunakan "Sesuai desain varian".
✅ Jika Transfer: customer sudah mengirim BUKTI TRANSFER.

Jika SATU SAJA syarat di atas belum terpenuhi → tulis status yang paling akurat (menunggu rekap, menunggu transfer, gali kebutuhan, dst). JANGAN pernah tulis "closing" jika masih ada data kosong!

ATURAN UPSELLING_TERKIRIM:
- Tulis "ya" jika dalam chat terlihat bot sudah menawarkan paket bundling/back to school kepada customer.
- Tulis "tidak" jika belum pernah ditawarkan.` },
                { role: "user", content: `Berikut riwayat chatnya, buatkan rekapannya:\n\n${historyText}` }
            ],
            temperature: 0.2
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

/**
 * Generate Follow-Up Message secara Organik (Anti-Banned)
 * Menggunakan AI untuk memastikan setiap pesan unik, tidak ada template kaku.
 */
async function generateOrganicFollowUp(customerName, chatContext, stageInstruction, productKnowledge) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Cepat dan murah untuk tugas teks pendek
            messages: [
                { 
                    role: "system", 
                    content: `Kamu adalah asisten jualan WhatsApp yang sangat natural, ramah, dan tidak terlihat seperti robot.
Tugasmu adalah membuat PESAN FOLLOW-UP (tindak lanjut) ke customer yang sempat menghilang (belum membalas/belum bayar).

INSTRUKSI FOLLOW-UP:
${stageInstruction}

PENGETAHUAN PRODUK:
${productKnowledge}

ATURAN ANTI-BANNED WA (SANGAT KRITIKAL):
1. PESAN HARUS SINGKAT! Maksimal 2 kalimat pendek saja.
2. JANGAN PERNAH menyertakan link/URL (mencegah flag spam).
3. Buat variasi kalimat yang sangat natural seperti ketikan jari manusia biasa.
4. Gunakan emoji secukupnya (maksimal 1 atau 2).
5. Jangan terlalu memaksa/menjual keras, gunakan pendekatan empati/halus.
6. JANGAN gunakan salam pembuka kaku seperti "Halo Bapak/Ibu". Gunakan nama customer langsung.` 
                },
                { 
                    role: "user", 
                    content: `Nama Customer: ${customerName}\nKonteks Percakapan Terakhir: ${chatContext || 'Belum ada konteks jelas'}\n\nTolong buatkan pesan follow up yang unik sekarang.` 
                }
            ],
            temperature: 0.7 // Cukup kreatif agar menghasilkan variasi teks organik
        }, { timeout: 10000 });

        return response.choices[0].message.content.trim();
    } catch (e) {
        logger.error(`[AI] Gagal generate organic follow-up: ${e.message}`);
        // Fallback organik darurat
        return `Ka ${customerName} 😊\nMasih ada yang mau ditanyakan kak tentang pesanannya?`;
    }
}

module.exports = {
    getAIResponse,
    generateChatSummary,
    transcribeAudio,
    calculateTypingDelay,
    prepareOutboundBubbles,
    sanitizeTextOutput,
    parseAutoLabels,
    RESPONSE_TYPE,
    generateOrganicFollowUp
};
