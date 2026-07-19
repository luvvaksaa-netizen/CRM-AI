const { Client } = require('ssh2');
const conn = new Client();

function execCmd(cmd, timeout = 15000) {
  return new Promise((resolve) => {
    conn.exec(cmd, (err, stream) => {
      if (err) { resolve('ERROR: ' + err.message); return; }
      let out = '';
      const timer = setTimeout(() => { stream.close(); resolve(out + '\n[TIMEOUT]'); }, timeout);
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { out += d.toString(); });
      stream.on('close', () => { clearTimeout(timer); resolve(out); });
    });
  });
}

async function run() {
  conn.on('ready', async () => {
    console.log('=== SEMUA STORE DI DATABASE ===');
    let out = await execCmd(`cd /opt/v2-core/app/backend && node -e '
const {Sequelize} = require("sequelize");
const s = new Sequelize({dialect:"sqlite", storage:"/opt/v2-core/app/data/database.sqlite", logging:false});
s.query("SELECT id, wa_id, name, is_bot_active FROM Stores ORDER BY id").then(function(r) {
  console.log("ID | wa_id | name | active");
  r[0].forEach(function(row) { console.log(row.id + " | " + row.wa_id + " | " + row.name + " | " + row.is_bot_active); });
  return s.query("SELECT COUNT(*) as cnt FROM ChatMessages WHERE store_wa_id IN (SELECT wa_id FROM Stores WHERE is_bot_active=1) GROUP BY store_wa_id");
}).then(function(r) { 
  if (r[0].length > 0) {
    console.log("\\nChat per active store:");
    r[0].forEach(function(row) { console.log("  " + row.store_wa_id + ": " + row.cnt + " chats"); });
  }
  s.close(); 
}).catch(function(e) { console.log("Error:", e.message); s.close(); });
' 2>&1`);
    console.log(out);

    console.log('\n=== SESSION FOLDERS ===');
    out = await execCmd('ls -la /opt/v2-core/app/backend/.wwebjs_auth/ 2>/dev/null | grep session');
    console.log(out);

    console.log('\nKamu mau:');
    console.log('1. Pakai 1 store aja (sebut nama store yg mana)');
    console.log('2. Pakai 3 store seperti sekarang');
    console.log('3. Hapus semua, bikin baru dengan nama custom');

    conn.end();
  });
  
  conn.on('error', (err) => console.error('Error:', err.message));
  
  conn.connect({
    host: '103.74.5.62', port: 22, username: 'root',
    password: 'O1fVmKlG9gdoQBYFr9ow',
    readyTimeout: 30000, keepaliveInterval: 10000,
    algorithms: {
      kex: ['diffie-hellman-group14-sha256','diffie-hellman-group14-sha1','ecdh-sha2-nistp256','ecdh-sha2-nistp384','ecdh-sha2-nistp521','diffie-hellman-group-exchange-sha256','diffie-hellman-group-exchange-sha1'],
      cipher: ['aes128-ctr','aes192-ctr','aes256-ctr','aes128-gcm@openssh.com','aes256-gcm@openssh.com'],
    },
  });
}

run();
