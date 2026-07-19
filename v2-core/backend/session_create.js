// session_create.js — Buat session WA dari laptop, lalu upload ke VPS
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

console.log('🟡 Membuka Chrome... (jangan tutup window Chrome)');
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'cs-hani-2741' }),
  puppeteer: { 
    headless: false, 
    args: ['--no-sandbox','--disable-setuid-sandbox'] 
  }
});

client.on('qr', qr => {
  console.log('\n=== SCAN QR CODE DI BAWAH INI ===\n');
  qrcode.generate(qr, { small: true });
  console.log('\n=== BUKA WHATSAPP HP > PERANGKAT TERTAUT > TAUTKAN PERANGKAT ===\n');
});

client.on('authenticated', () => {
  console.log('✅ Authenticated! Menunggu ready...');
});

client.on('ready', () => {
  console.log('✅✅✅ SUKSES! Session tersimpan di .wwebjs_auth/session-cs-hani-2741');
  console.log('Sekarang ZIP folder session-cs-hani-2741 dan upload ke VPS.');
  setTimeout(() => process.exit(0), 3000);
});

client.on('auth_failure', msg => {
  console.log('🔴 AUTH FAILURE:', msg);
  process.exit(1);
});

client.on('disconnected', reason => {
  console.log('🔴 DISCONNECTED:', reason);
  process.exit(1);
});

client.initialize().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
