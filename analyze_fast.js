const sqlite3 = require('sqlite3').verbose();
const learningSvc = require('./v2-core/backend/src/services/learning_service');

const db = new sqlite3.Database('D:/CRM-AI/data/database.sqlite');

db.serialize(() => {
    // Get 5 contacts with > 10 messages
    db.all(`SELECT contact_id, COUNT(*) as c FROM ChatMessages GROUP BY contact_id HAVING c > 10 ORDER BY RANDOM() LIMIT 5`, async (err, contacts) => {
        if (err) return console.error(err);
        
        for (const contact of contacts) {
            console.log(`\n=== Analyzing Contact: ${contact.contact_id} ===`);
            const msgs = await new Promise((res, rej) => {
                db.all(`SELECT sender_name, body, is_from_me FROM ChatMessages WHERE contact_id = ? ORDER BY timestamp ASC`, [contact.contact_id], (err, rows) => {
                    if (err) rej(err); else res(rows);
                });
            });
            
            const chatText = msgs.map(m => `${m.is_from_me ? 'CS' : 'Customer'}: ${m.body}`).join('\n');
            const productType = learningSvc.detectProductType(chatText);
            
            console.log(`Detected Product: ${productType}`);
            try {
                // We use the internal AI function directly just to see the result
                const analysis = await learningSvc._runClosingAnalysis({
                    storeWaId: 'local',
                    contactId: contact.contact_id,
                    agentId: null,
                    chatText: chatText,
                    sourceType: 'research'
                });
                console.log(`Analysis triggered. Check logs or DB for result.`);
            } catch (e) {
                console.error(e);
            }
        }
    });
});
