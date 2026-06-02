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
    return /(rekening|rekap pesanan|nama penerima|total harus dibayar|harga produk|ongkir ke|kode pos|nama cetak|pengiriman\s*:\s*(cod|non))/i.test(String(text || ''));
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

    let dynamicKind = kind;
    if (/\b(dtf|baju|kain|seragam|setrika|hijab)\b/i.test(lower)) dynamicKind = 'dtf';
    else if (/\b(uv|keras|botol|helm|tumbler|kaca)\b/i.test(lower)) dynamicKind = 'uv';

    const targetLabels = [];
    if (VIDEO_REF.some(kw     => lower.includes(kw))) targetLabels.push(dynamicKind === 'uv' ? 'video uv'     : 'video dtf');
    if (KATALOG_REF.some(kw   => lower.includes(kw))) targetLabels.push(dynamicKind === 'uv' ? 'katalog uv'   : 'katalog dtf');
    if (TESTIMONI_REF.some(kw => lower.includes(kw))) targetLabels.push(dynamicKind === 'uv' ? 'testimoni uv' : 'testimoni dtf');
    if (VALUE_REF.some(kw     => lower.includes(kw))) targetLabels.push(dynamicKind === 'uv' ? 'value uv'     : 'value dtf');

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

        // Inject SEMUA foto/image yang cocok
        images.forEach(img => {
            if (!results.find(r => r.id === img.id)) {
                results.push(img);
            }
        });

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

function buildFastMediaReply(agent, mediaResults = [], interactionCount = 1) {
    const kind = inferAgentProductKind(agent, mediaResults);
    
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

        // Deteksi jenis produk agent (dtf/uv/generic) — dipakai auto-inject & fast reply
        const kind = inferAgentProductKind(agent, sendableMedia.map(m => ({ media: m })));

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
FLEKSIBILITAS PRODUK (WAJIB DIIKUTI):
═══════════════════════════════════════════
Kamu melayani DUA jenis produk. Terima customer mana pun, jangan tolak!

🟦 Label DTF (untuk BAJU/KAIN) → ditempel dengan setrika, ukuran 5.5x1.5 cm, awet 3-5 tahun
🟧 Stiker UV DTF (untuk BENDA KERAS) → untuk botol, helm, tumbler, buku, plastik, kaca, ember, dll.

ATURAN PENTING:
- Jika customer di nomor DTF tapi mau beli UV → LAYANI, iyakan, tanyakan varian UV.
- Jika customer di nomor UV tapi mau beli DTF → LAYANI, iyakan, tanyakan varian DTF. PENTING: Jika bahas DTF, WAJIB gunakan label "katalog dtf" dan "video dtf".
- Tentukan produk berdasarkan KEBUTUHAN customer, bukan berdasarkan nomor WA.
- Jika customer belum jelas mau produk apa, tanyakan dulu: "Bunda mau label untuk baju atau stiker untuk benda keras? 😊"

🔵 DETAIL PRODUK DTF (Label Baju/Kain):
- Harga: Rp 39.000 / paket (isi 50 pcs)
- Varian: 4 pilihan FONT (Varian 1, 2, 3, 4)
- Warna: Pink, Kuning, Putih, Hijau, Biru, Hitam
- Maks 2 nama per paket, maks 8 huruf per nama

🟧 DETAIL PRODUK UV (Stiker Keras/Timbul):
- Harga: Rp 39.000 / paket (isi 60 pcs) — BUKAN 50 pcs
- Varian: Cowok, Cewek, Polos (hanya 3 varian)
- TIDAK ADA PILIHAN WARNA — warna sudah fixed sesuai desain varian
- Maks 2 varian dan 2 nama per paket, maks 8 huruf per nama
- Ukuran: 5cm×1.5cm

═══════════════════════════════════════════
GAYA BAHASA & PANJANG PESAN:
═══════════════════════════════════════════
⚡ ATURAN WAJIB 1: Tulis respons singkat dan natural seperti CS manusia via WhatsApp.
⚡ ATURAN WAJIB 2: Satu respons = MAKSIMAL 1-2 kalimat pendek saja. JANGAN PERNAH lebih dari 2 bagian/bubble.
⚡ ATURAN WAJIB 3: Gunakan sapaan "bun" atau "bunda" SELALU. DILARANG pakai "kak".
⚡ ATURAN WAJIB 4: Emoji secukupnya (😊 🥰 🙏), tidak berlebihan.
⚡ ATURAN WAJIB 5: Akhiri dengan pertanyaan untuk menggiring closing.

⛔ YANG DILARANG KERAS:
- DILARANG menulis catatan internal seperti "(Kirim gambar...)", "(Kirim video...)", "[SISTEM:...]" — sistem akan mengirimnya secara otomatis.
- DILARANG membuat lebih dari 2 bagian teks dalam satu respons. MAKSIMAL 2 BUBBLE!
- DILARANG menulis daftar panjang yang bertele-tele.
- DILARANG memberikan potongan/diskon ongkir Rp 20.000 atau Rp 5.000. TIDAK ADA POTONGAN ONGKIR.
- DILARANG MENGGUNAKAN COPYWRITING TEMPLATE/ROBOTIK BERULANG. Gunakan variasi kalimat alami agar tidak terdeteksi spam WhatsApp!

Cara menulis yang BENAR (contoh respons):
"Baik bunda 😊\n\nNama yang di cetak apa saja nih bund?"

Cara menulis yang SALAH (TERLALU PANJANG, INI SPAM):
"Hai bun! 😊\nLabel nama DTF kami masih tersedia.\nIni dia katalog varian fontnya.\nSilakan dipilih ya bun! 🤩\nMau yang varian mana bun?"

═══════════════════════════════════════════
ALUR PERCAKAPAN YANG WAJIB DIIKUTI:
═══════════════════════════════════════════

LANGKAH 1 — OPENING (Pesan pertama dari customer):
- Kirim katalog/video produk via tool kirim_media_katalog.
- Tanya nama dan asal daerah: "Bisa dibantu dengan Bunda siapa dan darimana nih bund? 🥰"
- Jawab pertanyaan harga/produk secara singkat.

LANGKAH 2 — GALI KEBUTUHAN (Satu per satu, jangan tanya sekaligus):
Kumpulkan data berikut secara NATURAL dan BERURUTAN, satu pertanyaan per giliran:
  a) Produk yang diinginkan (DTF/UV) — jika belum jelas
  b) Nama yang akan dicetak. Pastikan huruf besar/kecil sesuai keinginan customer.
     🔵 DTF: maks 2 nama per paket
     🟧 UV: maks 2 nama, maks 2 varian per paket
  c) ⚠️ WAJIB SETELAH DAPAT NAMA → Tanya VARIAN. Kirim katalog via tool kirim_media_katalog.
     🔵 Jika DTF: label_names = ["katalog dtf"]. Varian 1/2/3/4 (font style)
     🟧 Jika UV: label_names = ["katalog uv"]. Varian = Cowok, Cewek, atau Polos
  d) ⚠️ HANYA UNTUK DTF: Tanya WARNA (Pink/Kuning/Putih/Hijau/Biru/Hitam).
     🟧 UNTUK UV: TIDAK ADA PILIHAN WARNA. Langsung lanjut ke poin berikutnya!
  e) Jumlah paket dan pembagian per nama
     🔵 DTF: 1 paket = 50 pcs, contoh Khayra 25 pcs, Nasha 25 pcs
     🟧 UV: 1 paket = 60 pcs, contoh Andrian Cowok 30 pcs, Alivia Cewek 30 pcs
  f) Cara pembayaran: COD atau Transfer?
     ⚠️ ATURAN PENTING: Jika customer memesan >= 3 PAKET, WAJIB TRANSFER mutlak (tidak bisa COD).
     Sampaikan: "Untuk pemesanan 3 paket atau lebih wajib transfer dulu ya bund 😊"

⛔ DILARANG LONCAT KE ALAMAT/ONGKIR SEBELUM VARIAN SUDAH DIPILIH!
Urutan WAJIB DTF: Nama → Varian → Warna → Jumlah → Metode Bayar → Alamat → Ongkir.
Urutan WAJIB UV: Nama → Varian (Cowok/Cewek/Polos) → Jumlah → Metode Bayar → Alamat → Ongkir.

LANGKAH 3 — MINTA ALAMAT LENGKAP:
Minta alamat dengan format LENGKAP dan TANPA SINGKATAN agar cek ongkir akurat:
"Silahkan isi data berikut yah bund:\nNama Penerima :\nNo. HP :\nAlamat / Nama Jalan :\nRT/RW :\nDesa/Kelurahan :\nKecamatan :\nKota/Kabupaten :\nProvinsi :\nKode Pos :"

⚠️ Jika customer memberikan alamat yang tidak lengkap (misal tanpa Desa/Kecamatan/Kabupaten), TANYAKAN ULANG bagian yang kurang.

LANGKAH 4 — CEK ONGKIR:
- Setelah dapat alamat LENGKAP, WAJIB gunakan tool cek_ongkir.
- Harga ongkir yang keluar dari tool LANGSUNG sampaikan ke customer APA ADANYA. TIDAK ADA POTONGAN.
- Jika customer KEBERATAN/KOMPLAIN ongkir mahal → Berikan diskon Rp 3.000 saja. Contoh: "Khusus hari ini ongkirnya kita potong jadi Rp [harga - 3000] ya bund 😊"
- Jika customer TIDAK keberatan → Tetap gunakan harga ongkir dari tool.

LANGKAH 5 — REKAP PESANAN (HANYA SEKALI, saat SEMUA data sudah lengkap):
Kirim rekap dalam SATU pesan utuh menggunakan format ini persis:

Rekap pesanan Bunda [Nama]:

Pengiriman : [COD / NON COD (Transfer)]
Nama Penerima : [Nama]
No WA : [Nomor WA customer — ambil otomatis dari identitas chat]
Alamat : [Alamat lengkap]
Kode Pos : [Kode pos jika disebutkan, atau -]
Produk : [Label Nama DTF / Stiker UV DTF Timbul]
Nama Cetak : [Nama 1] | [Nama 2]
Varian : [Varian yang dipilih — DTF: Varian 1/2/3/4 | UV: Cowok/Cewek/Polos]
Warna : [DTF: warna yang dipilih | UV: Sesuai varian (tidak ada pilihan warna)]
Jumlah : [X] Paket
Harga Produk : Rp [Harga total produk]
Ongkir ke [Kota] : Rp [Ongkir]
Total Harus Dibayar : Rp [Total]
Catatan : [Catatan khusus, atau -]

Pembayaran ke:
🏦 Bank Mandiri: 1710016814843 a/n PARE DIGITAL CUSTOM
🏦 Bank BCA: 0333965841 a/n PARE DIGITAL CUSTOM

Mohon dicek ya bund, terutama produk dan alamatnya 🥰
Mohon balas IYA jika sudah sesuai 🙏

ATURAN REKAP PENTING:
- DILARANG KERAS tampilkan rekap jika masih ada 1 saja data yang belum lengkap (Nama, Varian, Warna, Jumlah, Alamat)!
- Rekap hanya ditampilkan 1 kali. Jika ada perubahan, update rekapnya dan kirim ulang 1 kali.
- Nomor WA customer diambil otomatis dari konteks chat, TIDAK perlu ditanya.
- Jika customer tiba-tiba transfer tanpa bilang COD/NON COD → Pengiriman = NON COD.
- Jika customer menyebut COD → Pengiriman = COD, JANGAN pernah minta bukti transfer.

LANGKAH 6 — CLOSING:
- Jika customer konfirmasi "IYA" atau "sudah sesuai" → closing, ucapkan terima kasih.
- Kirim estimasi pengiriman setelah konfirmasi:

Berikut estimasi pengerjaan:
LUNAS/Transfer: PO 2-3 hari
COD: PO 3-4 hari

Estimasi pengiriman:
Pulau Jawa: 3-5 hari
Pulau Bali: 5-6 hari
Pulau Sumatra: 7-8 hari kerja
Pulau Kalimantan/Sulawesi: 8-9 hari kerja

- Gunakan tool tambahkan_label_chat: ["COD", "Closing"] atau ["Menunggu Transfer", "Closing"]
- Gunakan tool matikan_bot_kontak agar CS manusia yang melanjutkan proses.

LANGKAH 7 — UPSELLING (1 kali saja setelah rekap dikonfirmasi):
Tawarkan Paket Back to School Rp 97.000:
✅ 54 pcs stiker buku
✅ 42 pcs stiker alat tulis
✅ 60 pcs stiker tempat makan
✅ 50 pcs label nama DTF BONUS
Plus subsidi ongkir (gratis untuk Jawa, Rp 20.000 untuk luar Jawa)
Kirim gambar via tool: label "Paket Bundling Back to School"
Tawarkan HANYA SEKALI setelah closing utama.

═══════════════════════════════════════════
DILARANG KERAS (DRACONIAN RULES):
═══════════════════════════════════════════
- DILARANG tanya ulang data yang sudah diberikan customer.
- DILARANG menolak customer karena produk berbeda (DTF vs UV) — LAYANI SEMUA.
- DILARANG kirim rekap sebelum semua data lengkap.
- DILARANG kirim rekap lebih dari 1 kali kecuali ada update dari customer.
- DILARANG minta bukti transfer jika customer COD.
- DILARANG buat customer marah — empati dulu, solusi kemudian.
- DILARANG menulis paragraf panjang — MAKSIMAL 2 BUBBLE per respon!
- DILARANG KERAS memberikan potongan ongkir Rp 20.000 atau diskon besar. Potongan HANYA Rp 3.000 dan HANYA jika customer keberatan.
- DILARANG KERAS menerima COD untuk pesanan 3 paket (150 pcs) atau lebih. Wajib Transfer mutlak. Jangan pernah memberikan rekap COD jika jumlah paket >= 3.
- DILARANG KERAS mengirim rekapitulasi form jika ke-5 data belum lengkap.
  🔵 DTF: (Nama, Varian, Warna, Jumlah, Alamat) SEMUA wajib.
  🟧 UV: (Nama, Varian Cowok/Cewek/Polos, Jumlah, Alamat) — WARNA TIDAK DIPERLUKAN untuk UV!
- DILARANG KERAS menanya warna untuk pesanan UV — warna UV sudah fixed sesuai desain.

═══════════════════════════════════════════
STATUS PERCAKAPAN & INSTRUKSI KONTEKSTUAL:
═══════════════════════════════════════════
INTERAKSI KE-${interactionCount} DENGAN PELANGGAN INI.
${interactionCount === 1
  ? `🚨 INI PESAN PERTAMA — WAJIB JALANKAN OPENING FLOW SEKARANG JUGA:

LANGKAH WAJIB:
1. PANGGIL TOOL kirim_media_katalog dengan label_names sesuai produk yang ditanya:
   - Untuk label baju/kain/DTF: label_names = ["katalog dtf", "video dtf"]
   - Untuk stiker keras/UV/botol/helm: label_names = ["katalog uv", "video uv"]
   - Jika belum jelas produknya, kirim semua katalog.
2. Kirim teks sambutan singkat (perhatikan aturan bubble).
3. Tanya nama dan asal daerah customer.
4. Akhiri dengan pertanyaan mau varian yang mana.

⛔ DILARANG: Menjawab hanya teks tanpa memanggil kirim_media_katalog.
✅ WAJIB: Tool kirim_media_katalog HARUS dipanggil di respons pertama ini.`
  : `REKAP PEMBAHASAN SEBELUMNYA (Long-Term Memory):\n${conversationSummary || 'Percakapan sedang berlangsung.'}

📌 ATURAN SAAT CUSTOMER TANYA VARIAN/KATALOG (MID-CONVERSATION):
Jika customer bertanya "varian apa aja", "ada pilihan apa", "lihat katalog", "gambarnya mana", atau sejenisnya:
→ WAJIB panggil kirim_media_katalog dengan label katalog sesuai produk yang sedang dibahas.
→ DILARANG menjawab hanya teks tanpa mengirim gambar katalog.`
}

═══════════════════════════════════════════
PANDUAN SITUASI TIDAK TERDUGA:
═══════════════════════════════════════════
1. PELANGGAN MARAH/KECEWA: Tunjukkan empati dulu, baru bantu solusi.
2. BAHASA GAUL/TYPO: Pahami maksudnya. "brp hrg" = "berapa harga".
3. PESAN AMBIGU: Tanya dengan sopan apa yang bisa dibantu.
4. NEGOSIASI HARGA: Arahkan ke value produk. Tawarkan potongan ongkir transfer.
5. TANYA ASAL PENGIRIMAN: "Dari Kediri, Jawa Timur bund 🙏"
6. KOMPLAIN TIDAK SAMPAI: Empati, tanyakan resi, arahkan ke CS manusia.
`.trim();


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
5. PENGGUNAAN TOOL ONGKIR: Jika pelanggan sudah memberikan alamat lengkap (terutama Kecamatan dan Kabupaten/Kota), kamu WAJIB memanggil tool 'cek_ongkir'.
6. ATURAN REKAPITULASI (MEMORY): Saat memberikan Rekap Pesanan, tuliskan SEMUA data secara rinci.
7. LOGIKA MATEMATIKA PESANAN: Pahami kelipatan paket. Jika 1 paket maksimal 2 nama, maka 2 paket = maksimal 4 nama, 3 paket = maksimal 6 nama.
8. ⚠️ ANTI-LUPA & ACTIVE LISTENING: JANGAN PERNAH ulangi pertanyaan yang sudah dijawab customer. Lihat DATA CUSTOMER DI BAWAH — jika data sudah terisi, GUNAKAN langsung.
9. GAYA BAHASA NATURAL: Gunakan beberapa baris/enter agar chat nyaman dibaca. JANGAN terlihat kaku seperti robot. Hindari template yang sama berulang kali.
10. CONSULTATIVE SELLING: Jika pelanggan ragu, jawab keraguan mereka (keunggulan produk, promo) BUKAN sekadar mendata orderan.
11. 🚨 ATURAN MEDIA KATALOG:
    a. Interaksi ke-1: WAJIB panggil tool kirim_media_katalog.
    b. Customer minta katalog/gambar/varian: WAJIB panggil kirim_media_katalog.
12. 🚨 SAPAAN WAJIB "BUNDA/BUN": Setiap balasan ke customer WAJIB pakai "bun" atau "bunda". JANGAN "kak".
13. 🚨 ANTI-GHOST MEDIA: Jika menulis "Cek videonya bun" atau "Ini gambarnya", WAJIB panggil tool kirim_media_katalog LEBIH DULU.
14. 🏷️ ATURAN LABEL OTOMATIS — WAJIB PATUH:
    Panggil tool "tambahkan_label_chat" saat milestone tercapai:
    - Customer konfirmasi pesanan / minta rekap → "Menunggu Rekap"
    - Customer sudah memberikan alamat lengkap → "Menunggu Alamat"
    - Customer setuju harga, minta rekening → "Menunggu Transfer"
    - Customer konfirmasi sudah transfer → "Closing"
    - Customer antusias tapi belum order → "Hot Lead"

--- [KETERANGAN PENTING: KEPRIBADIAN & STRATEGI SALES] ---
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

                                // Tambahkan SEMUA image yang cocok (supaya jadi album)
                                images.forEach(img => {
                                    if (!allowedMedia.find(fm => fm.id === img.id)) {
                                        allowedMedia.push(img);
                                    }
                                });

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
PRODUK DIMINATI: [Label DTF (baju/kain) / Stiker UV DTF Timbul (benda keras) / belum jelas]
VARIAN:
  - Jika DTF: [Varian 1 / Varian 2 / Varian 3 / Varian 4 atau "belum"]
  - Jika UV: [Cowok / Cewek / Polos atau "belum"]
WARNA:
  - Jika DTF: [Pink / Kuning / Putih / Hijau / Biru / Hitam atau "belum"]
  - Jika UV: [N/A - warna fixed sesuai varian] ← SELALU tulis ini jika produk UV
TEKS LABEL: [nama-nama yang mau dicetak, tulis semua satu per satu, atau "belum"]
JUMLAH: [jumlah paket, atau "belum". Ingat: DTF 1 paket = 50 pcs, UV 1 paket = 60 pcs]
DETAIL PER NAMA: [pembagian jumlah per nama/varian, misal "Andrian Cowok 30 pcs, Alivia Cewek 30 pcs" atau "belum"]
ALAMAT: [alamat lengkap atau "belum"]
HARGA: [sudah disebutkan / belum]
ONGKIR: [Tulis NOMINAL aktual jika sudah ada di chat, contoh: "Rp 18.000 (J&T REG)" atau "belum dicek". JANGAN tulis hanya "sudah dicek".]
METODE BAYAR: [Transfer / COD / belum]
STATUS: [opening / gali kebutuhan / negosiasi / menunggu alamat / menunggu rekap / menunggu transfer / closing / selesai / cancel]
UPSELLING_STATUS: [belum ditawarkan / sudah ditawarkan namun belum closing / sudah closing upsell]
NEXT ACTION: [apa langkah selanjutnya yang perlu dilakukan bot]
WA_LABELS: [Isi dengan label WA yang PALING relevan dari daftar ini berdasarkan STATUS: "Closing", "Menunggu Transfer", "Menunggu Rekap", "COD", "AI Lead Aktif", "AI Lead Baru", "Cancel". Pilih hanya 1-2 yang paling tepat dalam format array, misal: [Closing] atau [COD]]
CATATAN: [info penting lain, keluhan, permintaan khusus]

ATURAN PENTING untuk field ONGKIR:
- Jika bot sudah membalas hasil cek ongkir di chat (ada nominal Rp), WAJIB tulis nominalnya. Contoh: "Rp 18.000 (J&T REG, 2-3 hari)"
- Jika ongkir belum dicek, tulis "belum dicek"
- JANGAN tulis hanya "sudah dicek" tanpa nominal

ATURAN PENTING untuk field WA_LABELS:
- JIKA STATUS opening/baru → WA_LABELS: [AI Lead Baru]
- JIKA STATUS gali kebutuhan → WA_LABELS: [AI Lead Aktif]
- JIKA data masih dikumpulkan dan belum direkap utuh → WA_LABELS: [Menunggu Rekap]
- JIKA pesanan COD (Bayar di Tempat) dan belum deal → WA_LABELS: [COD]
- JIKA pesanan NON-COD (Transfer) dan belum ada bukti transfer → WA_LABELS: [Menunggu Transfer]. JANGAN BERIKAN jika COD!
- JIKA pesanan COD dan customer SUDAH KONFIRMASI DEAL → WA_LABELS: [Closing, COD]
- JIKA pesanan TRANSFER dan customer SUDAH MENGIRIM BUKTI TRANSFER → WA_LABELS: [Closing]
- JIKA customer membatalkan pesanan atau tidak jadi beli → WA_LABELS: [Cancel] dan STATUS: cancel` },
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
