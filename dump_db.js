const sqlite3 = require('sqlite3').verbose();
const dbPath = 'd:\\CRM-AI\\database-production.sqlite';

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening db:', err.message);
        process.exit(1);
    }
});

db.serialize(() => {
    // 2. Query Agents
    db.all("SELECT id, name, bot_name, system_prompt, product_knowledge, auto_labels FROM BotAgents", [], (err, agents) => {
        if (err) return console.error('Error querying BotAgents', err.message);
        console.log("=== AGENTS ===");
        agents.forEach(a => {
            console.log(`Agent ID: ${a.id} | Name: ${a.name} | Bot Name: ${a.bot_name}`);
            console.log(`Auto Labels: ${a.auto_labels}`);
            console.log(`System Prompt Length: ${a.system_prompt ? a.system_prompt.length : 0}`);
            console.log(`Product Knowledge Length: ${a.product_knowledge ? a.product_knowledge.length : 0}`);
            console.log("-----------------------");
        });
        console.log("\n");
        
        // 3. Query MediaAsset
        db.all("SELECT id, agent_id, label, type, description FROM MediaAssets", [], (err, media) => {
             if (err) return console.error('Error querying MediaAssets', err.message);
             console.log(`=== MEDIA ASSETS (Total: ${media.length}) ===`);
             media.forEach(m => {
                 console.log(`ID: ${m.id} | Agent: ${m.agent_id} | Label: ${m.label} | Type: ${m.type} | Desc: ${m.description}`);
             });
             db.close();
        });
    });
});
