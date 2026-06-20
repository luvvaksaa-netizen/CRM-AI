const sqlite3 = require('sqlite3').verbose();
// Cek database-production.sqlite
const db = new sqlite3.Database('D:/CRM-AI/database-production.sqlite', sqlite3.OPEN_READONLY, (err) => {
  if (err) { console.log('ERROR:', err.message); return; }
  db.all("SELECT name FROM sqlite_master WHERE type='table'", (err2, rows) => {
    const tables = (rows||[]).map(r => r.name);
    console.log('Tables in database-production.sqlite:', tables.join(', '));
    const key = ['contacts','messages','chats','stores','bot_agents','chat_messages','chat_summaries'];
    let done = 0;
    const found = tables.filter(t => key.some(k => t.toLowerCase().includes(k.replace('_',''))));
    if (!found.length) { db.close(); return; }
    found.forEach(t => {
      db.get(`SELECT COUNT(*) as c FROM "${t}"`, (e, r) => {
        console.log(`  ${t}: ${r ? r.c : 'ERR'} rows`);
        if (++done === found.length) db.close();
      });
    });
  });
});
