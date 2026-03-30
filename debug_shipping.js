const axios = require('axios');
require('dotenv').config();

const key = process.env.RAJAONGKIR_API_KEY || 'hRPis05Cb77150e5b90d505a42sljVLp';

const tests = [
    { name: "Official Starter HTTPS", url: "https://api.rajaongkir.com/starter/city", header: "key" },
    { name: "Official Starter HTTP", url: "http://api.rajaongkir.com/starter/city", header: "key" },
    { name: "Official Basic HTTPS", url: "https://api.rajaongkir.com/basic/city", header: "key" },
    { name: "Komerce v1 City", url: "https://rajaongkir.komerce.id/api/v1/city", header: "key" },
    { name: "Komerce v1 Destination", url: "https://rajaongkir.komerce.id/api/v1/destination", header: "key", params: { keyword: "Kediri" } },
    { name: "Komerce v1 X-API-KEY Province", url: "https://rajaongkir.komerce.id/api/v1/province", header: "x-api-key" }
];

async function runTests() {
    console.log("Starting Shipping API Discovery Tool...");
    console.log(`Using Key: ${key}`);

    for (const test of tests) {
        try {
            const headers = {};
            headers[test.header] = key;
            const res = await axios.get(test.url, { 
                headers, 
                params: test.params,
                timeout: 5000 
            });
            console.log(`✅ [${test.name}]: SUCCESS (Status: ${res.status})`);
            console.log(`   Sample Data: ${JSON.stringify(res.data).substring(0, 100)}...`);
        } catch (e) {
            console.log(`❌ [${test.name}]: FAILED (Status: ${e.response ? e.response.status : e.code})`);
        }
    }
}

runTests();
