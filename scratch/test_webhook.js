const axios = require('axios');

async function test() {
  console.log('--- Testing Webhook Lokal ---');
  try {
    const res = await axios.post('http://localhost:3000/webhook/roketchat', {
      event: 'message',
      deviceId: 'mvuo5hinj5rfjccl7bvdfaqm',
      from: '6281234567890@s.whatsapp.net',
      body: 'Halo ini tes lokal',
      timestamp: new Date().toISOString()
    });
    console.log('Response Status:', res.status);
    console.log('Response Data:', res.data);
  } catch (e) {
    console.error('Error:', e.message);
    if (e.response) {
      console.error('Response Status:', e.response.status);
      console.error('Response Data:', e.response.data);
    }
  }
}

test();
