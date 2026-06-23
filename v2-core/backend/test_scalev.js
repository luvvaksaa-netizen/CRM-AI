const axios = require('axios');

const apiKey = 'sk_UzMyqqZV0mrOLMiiiJF4hj9Mqy3g3JMLLUPK2rzTl4INbBSmvW9TCBRH4djl864F';
const storeUniqueId = 'store_jkCuKaF7LNtzTgK8YiTa1XNG';

const client = axios.create({
  baseURL: 'https://api.scalev.com',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  },
  timeout: 20000,
});

async function testCreateOrder() {
  const payload = {
    store_unique_id: storeUniqueId,
    customer_name: 'Test Customer',
    payment_method: 'qris',
    customer_phone: '',
  };

  try {
    const res = await client.post('/v3/orders', payload);
    console.log('Success:', res.data);
  } catch (err) {
    if (err.response) {
      console.log('Error Data:', JSON.stringify(err.response.data, null, 2));
    }
  }
}

testCreateOrder();
