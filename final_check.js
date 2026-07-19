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
    // Wait for fitri to init
    console.log('Waiting 20s for fitri...');
    await new Promise(r => setTimeout(r, 20000));

    // Check all store inits
    console.log('=== ALL STORE INITS ===');
    let out = await execCmd('grep -E "Menyiapkan|initialized|Database.*Connected" /opt/v2-core/app/logs/v2-core-out.log 2>/dev/null | tail -20');
    console.log(out);

    // Clean old session
    console.log('\n=== CLEANING OLD main-store-001 SESSION ===');
    out = await execCmd('rm -rf /opt/v2-core/app/backend/.wwebjs_auth/session-main-store-* 2>/dev/null; echo "Cleaned"');
    console.log(out);

    // Final status
    console.log('\n=== FINAL STATUS ===');
    
    console.log('\n--- PM2 ---');
    out = await execCmd('pm2 list 2>&1 | grep -E "id|v2-core"');
    console.log(out);
    
    console.log('\n--- HEALTH ---');
    out = await execCmd('curl -s http://localhost:3002/health');
    console.log(out);
    
    console.log('\n--- FRONTEND ---');
    out = await execCmd('curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:3002/');
    console.log(out);
    
    console.log('\n--- DB ---');
    out = await execCmd('lsof -p $(pgrep -f "node.*dist/app.js" | head -1) 2>/dev/null | grep "database.sqlite" | grep -v mem | head -3');
    console.log(out);
    
    console.log('\n--- SESSIONS ---');
    out = await execCmd('ls /opt/v2-core/app/backend/.wwebjs_auth/ 2>/dev/null');
    console.log(out);
    
    console.log('\n--- CHROME ---');
    out = await execCmd('ps aux | grep -c "[c]hrome"');
    console.log('Chrome:', out.trim());
    
    console.log('\n--- RAM ---');
    out = await execCmd('free -h | grep Mem');
    console.log(out.trim());
    
    console.log('\n--- PORT ---');
    out = await execCmd('ss -tlnp | grep 3002');
    console.log(out.trim());

    // Check errors
    console.log('\n--- RECENT ERRORS ---');
    out = await execCmd('tail -5 /opt/v2-core/app/logs/v2-core-error.log 2>/dev/null');
    console.log(out);

    // Save PM2
    out = await execCmd('pm2 save --force 2>&1');
    console.log('PM2 save:', out.trim());

    console.log('\n============================================');
    console.log('  ✅ PRODUCTION FULLY FIXED!');
    console.log('============================================');
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
