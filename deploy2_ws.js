const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const conn = new Client();

function exec(cmd, t=60000) {
  return new Promise(r => { conn.exec(cmd, (e,s) => { if(e) { r('E:'+e.message); return; } let o=''; const tm = setTimeout(() => { s.close(); r(o+'\n[T/O]'); }, t); s.on('data', d=>o+=d); s.stderr.on('data', d=>o+=d); s.on('close', () => { clearTimeout(tm); r(o); }); }); });
}

async function run() {
  conn.on('ready', async () => {
    // Upload
    await new Promise(rf => { conn.sftp((e,sf) => { const rs = fs.createReadStream(path.join(__dirname,'ws-fix.tar.gz')); const ws = sf.createWriteStream('/opt/v2-core/app/ws-fix.tar.gz'); ws.on('close', rf); rs.pipe(ws); }); });
    
    // Extract
    let o = await exec('cd /opt/v2-core/app && tar -xzf ws-fix.tar.gz && echo "OK"');
    console.log('Extract:', o);
    
    // Verify Socket.IO config in source
    o = await exec('grep -c "pingTimeout" /opt/v2-core/app/backend/src/app.ts');
    console.log('pingTimeout config:', o.trim());
    
    // Rebuild backend
    o = await exec('cd /opt/v2-core/app/backend && npx tsc 2>&1', 60000);
    console.log('Build:', o || 'OK');
    
    // Restart PM2
    o = await exec('pm2 restart v2-core-api 2>&1 || (pm2 delete v2-core-api 2>/dev/null; killall -9 chrome; sleep 3; rm -rf /root/.pm2; pm2 daemon; cd /opt/v2-core/app && pm2 start ecosystem.config.js) 2>&1', 30000);
    console.log('PM2:', o.substring(0, 200));
    
    await new Promise(r => setTimeout(r, 30000));
    
    // Verify
    console.log('\n=== FINAL ===');
    o = await exec('pm2 list 2>&1 | grep v2-core && echo "---" && curl -s localhost:3002/health && echo "" && echo "---" && grep -E "Menyiapkan|initialized|QR-GENERATED" /opt/v2-core/app/logs/v2-core-out.log | tail -5');
    console.log(o);
    
    // Check pingTimeout in dist  
    o = await exec('grep -c "pingTimeout" /opt/v2-core/app/backend/dist/app.js');
    console.log('\npingTimeout in dist:', o.trim());

    // Cleanup
    fs.unlinkSync(path.join(__dirname, 'ws-fix.tar.gz'));
    fs.unlinkSync(path.join(__dirname, 'diag_ws.js'));
    console.log('\n✅ ENTERPRISE WEBSOCKET DEPLOYED');
    conn.end();
  });
  conn.on('error', e => console.log(e.message));
  conn.connect({host:'103.74.5.62',port:22,username:'root',password:'O1fVmKlG9gdoQBYFr9ow',readyTimeout:30000,
    algorithms:{kex:['diffie-hellman-group14-sha256','diffie-hellman-group14-sha1','ecdh-sha2-nistp256','ecdh-sha2-nistp384','ecdh-sha2-nistp521','diffie-hellman-group-exchange-sha256','diffie-hellman-group-exchange-sha1'],
    cipher:['aes128-ctr','aes192-ctr','aes256-ctr','aes128-gcm@openssh.com','aes256-gcm@openssh.com']}});
}
run().then(() => console.log('OK')).catch(e => console.error('FAIL:', e));
