/**
 * @file ai_service.js
 * @description AI Service dengan Knowledge-Aware Media Architecture.
 * Media bisa berfungsi sebagai:
 *  - Knowledge: AI "membaca" analisis/transkrip media untuk menjawab pertanyaan
 *  - Catalog: AI bisa mengirim file ke customer
 *  - Both: Keduanya sekaligus
 */

const OpenAI = require('openai');
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

/**
 * Mendapatkan respons AI dengan Knowledge-Aware Media Architecture + Customer Media Awareness.
 * @param {string} userMessage          - Pesan teks dari pelanggan
 * @param {Array}  history              - Riwayat chat dari DB
 * @param {object} store                - Konfigurasi toko
 * @param {string} customerMediaContext - Hasil analisis gambar/media yang dikirim pelanggan (opsional)
 * @returns {Promise<{ type: string, content: string, mediaList?: Array }>}
 */
async function getAIResponse(userMessage, history = [], store = null, customerMediaContext = "") {
    if (!config.OPENAI_API_KEY || config.OPENAI_API_KEY.includes('your_openai_api_key')) {
        logger.error("OpenAI API Key belum dikonfigurasi!");
        return { type: RESPONSE_TYPE.TEXT, content: ERRORS.AI_FALLBACK };
    }

    try {
        const sysPrompt = store?.system_prompt || 'Anda adalah admin CS yang ramah.';
        const knowledge = store?.product_knowledge || 'Kami melayani pembuatan barang berkualitas.';
        const modelName = config.MODEL_NAME || 'gpt-4o-mini';
        const storeWaId = store?.wa_id || 'default';

        // ── KNOWLEDGE MEDIA: Media yang jadi pengetahuan AI ──────────────────
        const knowledgeMedia = await getKnowledgeMedia(storeWaId);
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
        const sendableMedia = await getSendableMedia(storeWaId);
        const catalogSection = sendableMedia.length > 0
            ? sendableMedia.map(m =>
                `- ID: ${m.id} | Label: "${m.label}" | Tipe: ${m.type}`
              ).join('\n')
            : '(Tidak ada media yang bisa dikirim)';

        const fullSystemInstruction = `
${sysPrompt}

═══════════════════════════════════════════
INFORMASI PRODUK & INVENTORY:
═══════════════════════════════════════════
${knowledge}

KETERSEDIAAN MEDIA:
- Kamu memiliki ${sendableMedia.length} item di katalog yang bisa dikirim.
- Kamu memiliki ${knowledgeMedia.length} item pengetahuan video/foto.

═══════════════════════════════════════════
PENGETAHUAN DARI MEDIA (Foto & Video):
═══════════════════════════════════════════
Gunakan bagian ini untuk menjawab pertanyaan detail tentang produk.
Kamu bisa menjawab dari pengetahuan ini TANPA harus mengirim file.
${knowledgeSection}

═══════════════════════════════════════════
KATALOG YANG BISA DIKIRIM KE PELANGGAN:
═══════════════════════════════════════════
Gunakan tool "kirim_media_katalog" dan masukkan ID media di bawah ini ke dalam ARRAY. 
Kamu BISA mengirim lebih dari satu media sekaligus jika pelanggan minta (misal: "minta semua katalog").

${catalogSection}

ATURAN PENTING:
1. Jawab akurat dan ramah berdasarkan semua informasi di atas.
2. Gunakan tool "cek_ongkir_jne" jika pelanggan tanya ongkir.
3. Gunakan tool "kirim_media_katalog" HANYA jika pelanggan minta lihat foto/video. 
4. Kamu bisa mengirim beberapa ID sekaligus dalam satu kali panggil tool.
5. Jika pelanggan minta "semua katalog", masukkan semua ID katalog di atas ke dalam array media_ids.
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

        let messages = [
            { role: "system", content: fullSystemInstruction },
            ...history.map(h => ({
                role: h.is_from_me ? 'assistant' : 'user',
                content: h.body || h.content || ""
            })),
            { role: "user", content: userContent }
        ];

        // === FIRST AI CALL ===
        const response = await openai.chat.completions.create({
            model: modelName,
            messages,
            tools,
            tool_choice: "auto",
            temperature: 0.7,
        });

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

                    const foundMedia = await MediaAsset.findAll({
                        where: { id: ids, store_wa_id: storeWaId }
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
    calculateTypingDelay,
    RESPONSE_TYPE
};
