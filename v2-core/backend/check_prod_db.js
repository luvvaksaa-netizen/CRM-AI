require('dotenv').config({path: __dirname + '/.env'});
const path = require('path');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const dbFile = path.resolve(DATA_DIR, 'database.sqlite');
console.log('DATA_DIR:', DATA_DIR);
console.log('DB path:', dbFile);

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READONLY, (err) => {
  if (err) { console.log('ERROR:', err.message); return; }
  db.all("SELECT name FROM sqlite_master WHERE type='table'", (err2, rows) => {
    const tables = (rows||[]).map(r => r.name);
    console.log('\nTables:', tables.join(', '));
    
    const queries = tables.filter(t => ['Stores','BotAgents','ChatMessages','ChatSummaries','FollowUps','AdminConfigs'].includes(t));
    let done = 0;
    if (queries.length === 0) { db.close(); return; }
    queries.forEach(t => {
      db.get(`SELECT COUNT(*) as c FROM "${t}"`, (e, r) => {
        console.log(`  ${t}: ${r ? r.c : 0} rows`);
        if (++done === queries.length) db.close();
      });
    });
  });
});
