const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('D:/CRM-AI/data/database.sqlite');

db.serialize(() => {
    // Find contacts with most messages
    db.all(`SELECT contact_id, COUNT(*) as count FROM ChatMessages GROUP BY contact_id ORDER BY count DESC LIMIT 3`, (err, contacts) => {
        if (err) {
            console.error("Error reading contacts:", err.message);
            return;
        }
        
        contacts.forEach(contact => {
            console.log(`\n=== CHAT HISTORY FOR ${contact.contact_id} (${contact.count} msgs) ===`);
            db.all(`SELECT sender_name, body, is_from_me, timestamp FROM ChatMessages WHERE contact_id = ? ORDER BY timestamp ASC LIMIT 50`, [contact.contact_id], (err, messages) => {
                if (err) {
                    console.error("Error reading messages:", err.message);
                    return;
                }
                messages.forEach(msg => {
                    const sender = msg.is_from_me ? "BOT/ADMIN" : (msg.sender_name || "CUSTOMER");
                    console.log(`[${msg.timestamp}] ${sender}: ${msg.body}`);
                });
            });
        });
    });
});
