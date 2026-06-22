const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const sqlite3 = require('sqlite3').verbose();
const learningSvc = require('../src/services/learning_service');

const dbPath = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR, 'database.sqlite') : path.resolve(__dirname, '../../../../data/database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log(`[Extractor] Memulai ekstraksi 500 chat menggunakan database: ${dbPath}`);

async function extractTopConversations(limit) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT contact_id, COUNT(*) as c 
            FROM ChatMessages 
            GROUP BY contact_id 
            HAVING c >= 10 
            ORDER BY c DESC 
            LIMIT ?
        `;
        db.all(query, [limit], (err, contacts) => {
            if (err) return reject(err);
            resolve(contacts);
        });
    });
}

async function getChatHistory(contactId) {
    return new Promise((resolve, reject) => {
        db.all(`SELECT sender_name, body, is_from_me FROM ChatMessages WHERE contact_id = ? ORDER BY timestamp ASC`, [contactId], (err, rows) => {
            if (err) return reject(err);
            const chatText = rows.map(m => `${m.is_from_me ? 'CS' : 'Customer'}: ${m.body}`).join('\n');
            resolve(chatText);
        });
    });
}

async function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}

async function runExtraction() {
    try {
        const contacts = await extractTopConversations(500);
        console.log(`[Extractor] Berhasil menemukan ${contacts.length} kontak dengan riwayat percakapan panjang.`);
        
        let successCount = 0;
        let failCount = 0;

        // Process sequentially with slight delay to prevent API rate limiting
        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            console.log(`\n[Extractor] (${i + 1}/${contacts.length}) Menganalisis riwayat obrolan: ${contact.contact_id} (${contact.c} pesan)...`);
            
            try {
                const chatText = await getChatHistory(contact.contact_id);
                // Execute analysis (saves to DB automatically via learningSvc)
                await learningSvc._runClosingAnalysis({
                    storeWaId: 'local',
                    contactId: contact.contact_id,
                    agentId: null, // default agent
                    chatText: chatText,
                    sourceType: 'bulk_research'
                });
                successCount++;
                console.log(`[Extractor] Sukses memproses ${contact.contact_id}`);
            } catch (err) {
                failCount++;
                console.error(`[Extractor] Gagal memproses ${contact.contact_id}:`, err.message);
            }
            
            // Wait 1 second between requests to respect DeepSeek / OpenAI rate limits
            await delay(1000);
        }

        console.log(`\n[Extractor] SELESAI. Sukses: ${successCount}, Gagal: ${failCount}.`);
        console.log(`[Extractor] Pola berhasil ditambahkan ke tabel ClosingPatterns!`);
        process.exit(0);
    } catch (e) {
        console.error(`[Extractor] Fatal Error:`, e);
        process.exit(1);
    }
}

runExtraction();
