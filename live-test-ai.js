// live-test-ai.js
require('dotenv').config();
const { OpenAI } = require('openai');

async function liveTest() {
    console.log("==========================================");
    console.log("🚀 MEMULAI LIVE TEST API DEEPSEEK & OPENAI");
    console.log("==========================================\n");

    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!deepseekKey && !openaiKey) {
        console.log("⚠️ PERINGATAN: Tidak ada DEEPSEEK_API_KEY atau OPENAI_API_KEY di file .env");
        console.log("Silakan masukkan API Key yang valid di .env terlebih dahulu agar bisa melakukan pemanggilan nyata.\n");
        return;
    }

    // 1. TEST DEEPSEEK API
    console.log("▶️ 1. MENGUJI DEEPSEEK API (Model: deepseek-chat)");
    if (deepseekKey) {
        try {
            const deepseek = new OpenAI({
                apiKey: deepseekKey,
                baseURL: 'https://api.deepseek.com/v1'
            });
            console.log("Memanggil DeepSeek API... (Mengirim pesan: 'Halo, apakah ini DeepSeek?')");
            
            const response = await deepseek.chat.completions.create({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: 'Halo, apakah ini DeepSeek? Jawab singkat.' }],
                max_tokens: 20
            });
            
            console.log("✅ BERHASIL! Respons DeepSeek:");
            console.log(`💬 "${response.choices[0].message.content}"`);
            console.log("");
        } catch (error) {
            console.log(`❌ GAGAL memanggil DeepSeek API.`);
            console.log(`Pesan Error: ${error.message}`);
            if (error.status === 401 || error.message.includes('401')) {
                console.log("ℹ️ Solusi: DEEPSEEK_API_KEY Anda tidak valid atau saldo habis. Pastikan key benar.");
            }
            console.log("");
        }
    } else {
        console.log("⏩ SKIP: DEEPSEEK_API_KEY tidak ditemukan di .env\n");
    }

    // 2. TEST OPENAI API (Fallback/Vision)
    console.log("▶️ 2. MENGUJI OPENAI API (Model: gpt-4o-mini)");
    if (openaiKey) {
        try {
            const openai = new OpenAI({ apiKey: openaiKey });
            console.log("Memanggil OpenAI API... (Mengirim pesan: 'Halo')");
            
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: 'Halo, jawab singkat.' }],
                max_tokens: 20
            });
            
            console.log("✅ BERHASIL! Respons OpenAI:");
            console.log(`💬 "${response.choices[0].message.content}"`);
            console.log("");
        } catch (error) {
            console.log(`❌ GAGAL memanggil OpenAI API.`);
            console.log(`Pesan Error: ${error.message}`);
            if (error.status === 401 || error.message.includes('401')) {
                console.log("ℹ️ Solusi: OPENAI_API_KEY Anda tidak valid atau kuota habis. Pastikan key benar.");
            }
            console.log("");
        }
    } else {
        console.log("⏩ SKIP: OPENAI_API_KEY tidak ditemukan di .env\n");
    }

    console.log("==========================================");
    console.log("🏁 LIVE TEST SELESAI");
    console.log("==========================================");
}

liveTest();
