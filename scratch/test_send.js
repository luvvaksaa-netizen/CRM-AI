const axios = require('axios');

async function testSend() {
  const token = 'mvuo5hinj5rfjccl7bvdfaqm.9b48b4c0-292f-4bcd-a5c9-c15cece18efc';
  // Saya akan mencoba mengirim ke nomor bot itu sendiri sebagai tes (Loopback)
  // Atau jika Anda ingin saya kirim ke nomor lain, silakan beri tahu.
  const targetPhone = '6282245587996'; 
  
  console.log('--- Mencoba Kirim Pesan via RocketChat API ---');
  try {
    const res = await axios.post('https://roketchat.com/api/v1/messages/text', {
      phone: targetPhone,
      body: 'Halo! Ini adalah tes koneksi otomatis dari sistem CRM Anda. Jika Anda menerima ini, berarti jalur pengiriman (Token) Anda 100% VALID!',
      token: token
    });
    console.log('Hasil:', JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.error('Gagal Kirim:', e.response ? e.response.data : e.message);
  }
}

testSend();
