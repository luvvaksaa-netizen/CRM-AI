const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('kill -9 1726214 2>/dev/null; pm2 kill 2>/dev/null; killall -9 chrome 2>/dev/null; sleep 3; rm -rf /root/.pm2; sleep 1; pm2 daemon 2>/dev/null; sleep 1; cd /opt/v2-core/app && pm2 start ecosystem.config.js 2>&1; sleep 25; echo "=== PM2 ===" && pm2 list 2>&1 | grep v2-core && echo "=== HEALTH ===" && curl -s localhost:3002/health && echo "" && echo "=== INIT ===" && grep -E "Menyiapkan|initialized|QR-GENERATED" /opt/v2-core/app/logs/v2-core-out.log | tail -5', (e,s) => {
    let o=''; s.on('data', d=>o+=d); s.stderr.on('data', d=>o+=d);
    s.on('close',()=>{ console.log(o); c.end(); });
  });
});
c.on('error', e=>console.log(e.message));
c.connect({host:'103.74.5.62',port:22,username:'root',password:'O1fVmKlG9gdoQBYFr9ow',readyTimeout:30000,
  algorithms:{kex:['diffie-hellman-group14-sha256','diffie-hellman-group14-sha1','ecdh-sha2-nistp256','ecdh-sha2-nistp384','ecdh-sha2-nistp521','diffie-hellman-group-exchange-sha256','diffie-hellman-group-exchange-sha1'],
  cipher:['aes128-ctr','aes192-ctr','aes256-ctr','aes128-gcm@openssh.com','aes256-gcm@openssh.com']}});
