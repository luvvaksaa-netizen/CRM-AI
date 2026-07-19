const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const conn = new Client();

function exec(cmd, t=30000) {
  return new Promise(r => { conn.exec(cmd, (e,s) => { if(e) { r('E:'+e.message); return; } let o=''; const tm = setTimeout(() => { s.close(); r(o+'\n[T/O]'); }, t); s.on('data', d=>o+=d); s.stderr.on('data', d=>o+=d); s.on('close', () => { clearTimeout(tm); r(o); }); }); });
}

async function run() {
  conn.on('ready', async () => {
    // 1. Update nginx for WebSocket enterprise stability
    console.log('=== FIXING NGINX FOR WEBSOCKET ===');
    
    const nginxConfig = `server {
    server_name crm.datasdm.com;

    root /opt/v2-core/app/frontend/dist;
    index index.html;

    # Health check
    location = /health {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Uploads
    location /uploads/ {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_connect_timeout 60s;
        proxy_buffering off;
    }

    # Socket.IO — enterprise WebSocket
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_connect_timeout 60s;
        proxy_buffering off;
        proxy_cache off;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/crm.datasdm.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crm.datasdm.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = crm.datasdm.com) {
        return 301 https://$host$request_uri;
    }
    listen 80;
    server_name crm.datasdm.com;
    return 404;
}
`;

    let o = await exec(`cat > /etc/nginx/sites-enabled/crm-datasdm << 'NGX'
${nginxConfig}
NGX
echo "NGINX WRITTEN"`);
    console.log(o);

    // Test config
    o = await exec('nginx -t 2>&1');
    console.log('Nginx test:', o.trim());
    
    // Reload
    o = await exec('nginx -s reload 2>&1 | tail -1');
    console.log('Nginx reload:', o.trim());

    // 2. Create tar of updated backend source
    const { execSync } = require('child_process');
    execSync('cd /d/jhe/CRM-AI && tar -czf /tmp/ws-fix.tar.gz --exclude=node_modules --exclude=data --exclude=backups --exclude=.wwebjs_auth --exclude=logs --exclude=dist --exclude=snapshot-* --exclude="*.sqlite" --exclude="*.sqlite-shm" --exclude="*.sqlite-wal" --exclude=.git -C v2-core . 2>&1', { encoding: 'utf-8' });
    
    // Upload 
    const localTar = '/tmp/ws-fix.tar.gz';
    const remoteTar = '/opt/v2-core/app/ws-fix.tar.gz';
    await new Promise(rf => { conn.sftp((e,sf) => { const rs = fs.createReadStream(localTar); const ws = sf.createWriteStream(remoteTar); ws.on('close', rf); rs.pipe(ws); }); });

    // Extract & rebuild backend
    o = await exec('cd /opt/v2-core/app && tar -xzf ws-fix.tar.gz 2>&1 && echo "EXTRACTED"');
    console.log(o);

    // Verify Socket.IO fix
    o = await exec('grep -A5 "new Server" /opt/v2-core/app/backend/src/app.ts | head -10');
    console.log('Socket.IO config:', o);

    // Rebuild backend
    console.log('Building backend...');
    o = await exec('cd /opt/v2-core/app/backend && npx tsc 2>&1', 60000);
    console.log('Build:', o || 'OK');

    // Restart PM2
    o = await exec('pm2 restart v2-core-api 2>&1 || (pm2 delete v2-core-api 2>/dev/null; killall -9 chrome 2>/dev/null; sleep 2; rm -rf /root/.pm2 2>/dev/null; pm2 daemon; sleep 1; cd /opt/v2-core/app && pm2 start ecosystem.config.js) 2>&1', 30000);
    console.log('Restart:', o.includes('online') ? 'OK' : 'Triggering force...');

    await new Promise(r => setTimeout(r, 25000));

    // Verify
    console.log('\n=== FINAL ===');
    o = await exec('pm2 list 2>&1 | grep v2-core && echo "---" && curl -s localhost:3002/health && echo "---" && curl -s -o /dev/null -w "HTTP %{http_code}" https://crm.datasdm.com/');
    console.log(o);

    // Verify Socket.IO in dist
    o = await exec('grep -c "pingTimeout\|pingInterval\|connectTimeout" /opt/v2-core/app/backend/dist/app.js 2>/dev/null');
    console.log('pingTimeout in dist:', o.trim());

    console.log('✅ ALL DONE');
    conn.end();
  });
  conn.on('error', e => console.log(e.message));
  conn.connect({host:'103.74.5.62',port:22,username:'root',password:'O1fVmKlG9gdoQBYFr9ow',readyTimeout:30000,
    algorithms:{kex:['diffie-hellman-group14-sha256','diffie-hellman-group14-sha1','ecdh-sha2-nistp256','ecdh-sha2-nistp384','ecdh-sha2-nistp521','diffie-hellman-group-exchange-sha256','diffie-hellman-group-exchange-sha1'],
    cipher:['aes128-ctr','aes192-ctr','aes256-ctr','aes128-gcm@openssh.com','aes256-gcm@openssh.com']}});
}

run().then(() => console.log('OK')).catch(e => console.error('FAIL:', e));
