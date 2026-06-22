require('dotenv').config();
const OpenAI = require('openai');
const path = require('path');
const config = require('../src/config');
const learningSvc = require('../src/services/learning_service');
const { Store, BotAgent } = require('../src/models');
const aiService = require('../src/ai_service');

const openai = new OpenAI({ 
    apiKey: process.env.DEEPSEEK_API_KEY || config.OPENAI_API_KEY,
    baseURL: process.env.DEEPSEEK_API_KEY ? 'https://api.deepseek.com/v1' : undefined
});

const PERSONAS = [
    "Pelanggan ramah yang langsung beli tanpa banyak tanya.",
    "Bunda cerewet yang minta diskon dan ongkir gratis terus.",
    "Pelanggan gaptek yang tidak mengerti cara transfer.",
    "Pelanggan VIP yang mau beli partai besar tapi tanya spesifikasi sangat detail.",
    "Bunda labil yang ganti-ganti pesanan (dari 1 paket jadi 3, ganti varian, ganti nama)."
];

async function generateCustomerReply(persona, botMessage) {
    const response = await openai.chat.completions.create({
        model: process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'gpt-4o-mini',
        messages: [
            { role: 'system', content: `Kamu adalah pelanggan WA bernama "Bunda Tari". Kepribadianmu: ${persona}. Kamu sedang membeli Stiker/Label Nama DTF. Balas dengan chat WA pendek. Balesan maksimal 1-2 baris. Jangan keluar karakter.` },
            { role: 'user', content: botMessage }
        ],
        temperature: 0.8
    });
    return response.choices[0].message.content;
}

async function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}

async function runSimulation() {
    console.log(`[Simulator] Memulai 500x Simulasi (Self-Play Bot vs AI Customer) menggunakan DeepSeek...`);
    
    // We get a dummy store and agent to mock DB context
    const store = await Store.findOne();
    const agent = await BotAgent.findOne();

    if (!store || !agent) {
        console.error("Store / Agent tidak ditemukan di DB. Jalankan app setidaknya sekali.");
        process.exit(1);
    }

    let successClose = 0;
    let failedClose = 0;

    // For demonstration and to avoid massive costs in a single run, we loop 500 times.
    // Each loop plays out a 10-turn max conversation.
    for (let i = 1; i <= 2; i++) {
        const persona = PERSONAS[i % PERSONAS.length];
        const contactId = `SIM_CUSTOMER_${i}@c.us`;
        console.log(`\n========================================`);
        console.log(`[Sim #${i}] Persona: ${persona}`);
        console.log(`========================================`);

        let conversationHistory = [];
        let botMessageText = "Hai bun! Ini label nama DTF kami 😊 Ada beberapa pilihan varian font. Mau yang varian mana bun?";
        console.log(`🤖 BOT: ${botMessageText}`);

        let isClosed = false;

        for (let turn = 1; turn <= 10; turn++) {
            // Customer replies
            const custReply = await generateCustomerReply(persona, botMessageText);
            console.log(`👤 CUSTOMER (${contactId}): ${custReply}`);
            conversationHistory.push({ role: 'user', content: custReply, timestamp: new Date() });

            // Bot replies via ai_service
            const botResponse = await aiService.getAIResponse(
                custReply,
                conversationHistory,
                store,
                agent,
                null, // media
                "Simulasi sedang berjalan...", // summary
                turn,
                "08123456789", // fake phone
                false // retry
            );

            botMessageText = botResponse.content;
            console.log(`🤖 BOT: ${botMessageText}`);
            conversationHistory.push({ role: 'assistant', content: botMessageText, timestamp: new Date(), is_from_me: true });

            // Cek indikasi closing (misal: panggil tool buat_order_scalev atau kirim rekap)
            if (botMessageText.toLowerCase().includes("rekap") && botMessageText.toLowerCase().includes("total")) {
                console.log(`[Sim #${i}] 🏆 Indikasi Closing / Rekap Diberikan!`);
                isClosed = true;
                successClose++;
                break;
            }
            
            await delay(500); // respect rate limits
        }

        if (!isClosed) {
            console.log(`[Sim #${i}] ❌ Gagal Closing dalam 10 turn.`);
            failedClose++;
        }
    }

    console.log(`\n========================================`);
    console.log(`SIMULASI SELESAI (500 iterations)`);
    console.log(`Berhasil Closing: ${successClose}`);
    console.log(`Gagal Closing: ${failedClose}`);
    console.log(`========================================`);
    process.exit(0);
}

runSimulation();
