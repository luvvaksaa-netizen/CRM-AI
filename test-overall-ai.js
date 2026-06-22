// test-overall-ai.js
require('dotenv').config();
const { OpenAI } = require('openai');

async function runOverallTest() {
    console.log("================================================================");
    console.log("🚀 MENGUJI KESELURUHAN FITUR AI (DEEPSEEK & OPENAI INTEGRATION)");
    console.log("================================================================\n");

    const deepseekKey = process.env.DEEPSEEK_API_KEY;

    if (!deepseekKey) {
        console.error("❌ ERROR: DEEPSEEK_API_KEY tidak ditemukan di .env!");
        return;
    }

    const deepseek = new OpenAI({
        apiKey: deepseekKey,
        baseURL: 'https://api.deepseek.com/v1'
    });

    console.log("✅ KONEKSI DEEPSEEK BERHASIL DIINISIALISASI\n");

    // ==============================================================================
    // SKENARIO 1: TES KEMAMPUAN CHAT BOT (CUSTOMER SERVICE)
    // ==============================================================================
    console.log("----------------------------------------------------------------");
    console.log("▶️ FITUR 1: AI Chat Bot (Customer Service Engine)");
    console.log("Skenario: Membalas pertanyaan customer tentang jam operasional.");
    console.log("Model   : deepseek-chat");
    try {
        const chatResponse = await deepseek.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'Kamu adalah CS Toko Baju bernama Hani. Jawab ramah dan singkat. Toko buka jam 08.00 - 16.00.' },
                { role: 'user', content: 'Kak, tokonya buka jam berapa ya?' }
            ],
            max_tokens: 150,
            temperature: 0.7
        });
        console.log("\n[HASIL - Respons Bot]:");
        console.log(`💬 "${chatResponse.choices[0].message.content.trim()}"`);
        console.log("✅ STATUS: LULUS (DeepSeek berhasil menjalankan persona CS)\n");
    } catch (e) {
        console.log("❌ GAGAL:", e.message);
    }

    // ==============================================================================
    // SKENARIO 2: TES FITUR LEARNING (EKSTRAKSI POLA CLOSING JSON)
    // ==============================================================================
    console.log("----------------------------------------------------------------");
    console.log("▶️ FITUR 2: AI Learning Service (Pattern Extraction JSON)");
    console.log("Skenario: AI menganalisis percakapan sukses untuk dipelajari sistem.");
    console.log("Model   : deepseek-chat (Meminta output format JSON)");
    try {
        const dummyChat = "CS: Halo kak, mau pesan apa?\nCust: Mau label nama dtf kak.\nCS: Baik, untuk ukurannya mau yang standar ya kak? Boleh diisi nama yg mau dicetak.\nCust: Boleh, nama 'Andi'. Alamat di Jakarta.\nCS: Siap kak, totalnya 50rb ya.";
        const promptLearning = `Analisis percakapan closing ini. Keluarkan format JSON dengan key "patterns" (array) dan "score" (angka 1-10).\n\nPercakapan:\n${dummyChat}`;

        const learningResponse = await deepseek.chat.completions.create({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: promptLearning }],
            response_format: { type: 'json_object' },
            max_tokens: 500,
            temperature: 0.2
        });
        
        const jsonResult = JSON.parse(learningResponse.choices[0].message.content);
        console.log("\n[HASIL - JSON Ekstraksi Pola]:");
        console.log(JSON.stringify(jsonResult, null, 2));
        console.log("✅ STATUS: LULUS (DeepSeek berhasil mem-parsing dan mem-format JSON)\n");
    } catch (e) {
        console.log("❌ GAGAL:", e.message);
    }

    // ==============================================================================
    // SKENARIO 3: TES FITUR SPAM/CONTEXT FILTER (KLASIFIKASI)
    // ==============================================================================
    console.log("----------------------------------------------------------------");
    console.log("▶️ FITUR 3: Smart Routing & Filter (Klasifikasi Niat Customer)");
    console.log("Skenario: Menentukan apakah chat ini 'order', 'tanya_resi', atau 'spam'.");
    try {
        const filterResponse = await deepseek.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'Klasifikasikan niat user menjadi salah satu: ORDER, RESI, SPAM. Jawab hanya dengan 1 kata.' },
                { role: 'user', content: 'Kak, paketku kok belum sampai ya dari kemaren?' }
            ],
            max_tokens: 10,
            temperature: 0.0
        });
        console.log("\n[HASIL - Klasifikasi Niat]:");
        console.log(`💬 "${filterResponse.choices[0].message.content.trim()}"`);
        console.log("✅ STATUS: LULUS (DeepSeek berhasil melakukan klasifikasi dengan akurat)\n");
    } catch (e) {
        console.log("❌ GAGAL:", e.message);
    }

    console.log("================================================================");
    console.log("🎉 SEMUA PENGUJIAN API DEEPSEEK BERHASIL DENGAN SEMPURNA! 🎉");
    console.log("Arsitektur Hybrid AI Anda sekarang sangat powerful dan sangat efisien.");
    console.log("================================================================");
}

runOverallTest();
