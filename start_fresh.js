const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  c.exec('killall -9 chrome 2>/dev/null; rm -rf /opt/crm-ai-fresh/v2-core/backend/.wwebjs_auth/* /root/.pm2 2>/dev/null; sleep 1; pm2 daemon 2>/dev/null; sleep 1; cd /opt/crm-ai-fresh && pm2 start ecosystem.config.js 2>&1 | tail -5', (e,s) => {
    let o=''; s.on('data', d=>o+=d); s.on('close',()=>{
      console.log(o);
      setTimeout(() => {
        c.exec('pm2 list 2>&1 | grep -E "id|api" && echo "---" && curl -s localhost:3002/health && echo "" && echo "---" && grep "QR-GENERATED\|initialized" /opt/crm-ai-fresh/v2-core/backend/logs/*.log 2>/dev/null | tail -3', (e2,s2) => {
          let o2=''; s2.on('data', d=>o2+=d); s2.on('close',()=>{ console.log(o2); c.end(); });
        });
      }, 30000);
    });
  });
});
c.on('error', e=>console.log(e.message));
c.connect({host:'103.74.5.62',port:22,username:'root',password:'O1fVmKlG9gdoQBYFr9ow',readyTimeout:30000,
  algorithms:{kex:['diffie-hellman-group14-sha256','diffie-hellman-group14-sha1','ecdh-sha2-nistp256','ecdh-sha2-nistp384','ecdh-sha2-nistp521','diffie-hellman-group-exchange-sha256','diffie-hellman-group-exchange-sha1'],
  cipher:['aes128-ctr','aes192-ctr','aes256-ctr','aes128-gcm@openssh.com','aes256-gcm@openssh.com']}});
