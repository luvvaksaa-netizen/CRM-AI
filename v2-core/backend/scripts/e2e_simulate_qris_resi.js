require('dotenv').config();
const { sequelize, Store, ChatMessage, ChatSummary } = require('../src/models/index');
const aiService = require('../src/ai_service');
const { v4: uuidv4 } = require('uuid');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    console.log("==================================================");
    console.log("🚀 MEMULAI E2E SIMULASI: QRIS & RESI MENGANTAR");
    console.log("==================================================");
    
    await sequelize.authenticate();
    const store = await Store.findOne({ where: { is_bot_active: true } });
    if (!store) {
        console.error("❌ Tidak ada store yang aktif/bot hidup. Nyalakan bot di Dashboard dulu.");
        process.exit(1);
    }

    const storeWaId = store.wa_id;
    const contactId = '6289999999999@c.us';
    
    console.log(`✅ Menggunakan Store: ${storeWaId}`);
    console.log(`✅ Menggunakan Customer Dummy: ${contactId}`);
    
    // 1. Clear Firewall/Pause
    // await sequelize.query(`DELETE FROM bot_paused_contacts WHERE store_wa_id = '${storeWaId}' AND contact_id = '${contactId}'`);
    
    // 2. Clear Old Chat for this Dummy
    await ChatMessage.destroy({ where: { store_wa_id: storeWaId, contact_id: contactId } });
    await ChatSummary.destroy({ where: { store_wa_id: storeWaId, contact_id: contactId } });
    
    // Skenario: Customer ingin UV, Minta Transfer, Kasih Alamat, lalu Kirim Bukti Transfer
    const customerMessages = [
        "Halo bun, mau pesan stiker UV",
        "Nama yang dicetak: Budi",
        "Varian Cowok",
        "1 paket aja",
        "Transfer aja bun biar cepat",
        "Budi, 08123456789, Jl. Sudirman No 1, RT 1/RW 1, Kelurahan Melawai, Kecamatan Kebayoran Baru, Jakarta Selatan, DKI Jakarta, 12160"
    ];

    let history = [];
    
    for (let i = 0; i < customerMessages.length; i++) {
        const cMsg = customerMessages[i];
        console.log(`\n👤 CUSTOMER: ${cMsg}`);
        
        await ChatMessage.create({
            
            store_wa_id: storeWaId,
            contact_id: contactId,
            wa_message_id: `msg_c_${Date.now()}`,
            body: cMsg,
            is_from_me: false,
            sender_name: 'Test E2E Buyer',
            timestamp: new Date()
        });
        
        history.push({ role: 'user', content: cMsg });

        const botResponse = await aiService.getAIResponse(
            cMsg,
            history,
            store,
            { name: 'CS Bot Simulasi' }, 
            [], [], [], 0, '6289999999999', '',
            store.master_prompt, 
            store.product_knowledge
        );

        const replyStr = typeof botResponse === 'string' ? botResponse : botResponse.reply || '';
        history.push({ role: 'assistant', content: replyStr });
        const bubbles = replyStr.split('\n\n').filter(b => b.trim());
        for (const bubble of bubbles) {
            console.log(`🤖 BOT: ${bubble}`);
            await ChatMessage.create({
                
                store_wa_id: storeWaId,
                contact_id: contactId,
                wa_message_id: `msg_b_${Date.now()}_${Math.random()}`,
                body: bubble,
                is_from_me: true,
                sender_name: 'CS Bot',
                timestamp: new Date()
            });
            await sleep(500);
        }
        await sleep(1500);
    }
    
    console.log("\n==================================================");
    console.log("📸 TAHAP 2: CUSTOMER MENGIRIM BUKTI TRANSFER");
    console.log("==================================================");
    
    // Asumsikan sistem Vision mendeteksi gambar sebagai bukti transfer valid
    const tfMsg = "[AI-VISION: Ini adalah gambar bukti transfer bank BCA ke JAKA MULIA JAYA sebesar Rp 39.000 + Ongkir lunas]";
    console.log(`👤 CUSTOMER: (Kirim Gambar Bukti Transfer) -> ${tfMsg}`);
    
    await ChatMessage.create({
        
        store_wa_id: storeWaId,
        contact_id: contactId,
        wa_message_id: `msg_c_${Date.now()}`,
        body: tfMsg,
        is_from_me: false,
        sender_name: 'Test E2E Buyer',
        timestamp: new Date()
    });
    
    history.push({ role: 'user', content: tfMsg });
    
    const finalBotResponse = await aiService.getAIResponse(
            tfMsg,
            history,
            store,
            { name: 'CS Bot Simulasi' }, 
            [], [], [], 0, '6289999999999', '',
            store.master_prompt, 
            store.product_knowledge
    );
    
        const finalReplyStr = typeof finalBotResponse === 'string' ? finalBotResponse : finalBotResponse.reply || '';
        history.push({ role: 'assistant', content: finalReplyStr });
        const finalBubbles = finalReplyStr.split('\n\n').filter(b => b.trim());
    for (const bubble of finalBubbles) {
        console.log(`🤖 BOT: ${bubble}`);
        await ChatMessage.create({
            
            store_wa_id: storeWaId,
            contact_id: contactId,
            wa_message_id: `msg_b_${Date.now()}_${Math.random()}`,
            body: bubble,
            is_from_me: true,
            sender_name: 'CS Bot',
            timestamp: new Date()
        });
        await sleep(500);
    }

    console.log("\n✅ SIMULASI E2E SELESAI!");
    console.log("👉 Silakan buka Dashboard Web Anda.");
    console.log("👉 Cari riwayat chat dari kontak 'Test E2E Buyer' (+6289999999999).");
    console.log("👉 Anda akan melihat seluruh percakapan, termasuk pengiriman QRIS dan eksekusi RESI Mengantar!");
    process.exit(0);
}

run().catch(err => {
    console.error("Terjadi Error:", err);
    process.exit(1);
});
