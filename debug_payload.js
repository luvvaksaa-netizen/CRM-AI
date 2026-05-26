const axios = require('axios');

async function test() {
    const url = 'https://api-public.mengantar.com/api/order/allEstimateMultipleOrigin';
    const payload = {
        origin_id: "5fc62f5df8f44b34aa4c0d8c", // Kediri
        destination_id: "Kalisoro, Tawangmangu", // Trying text instead of Mongo ID
        weight: "1",
        COD_AMOUNT: "123"
    };

    try {
        const res = await axios.post(url, payload, {
            headers: {
                // Not using auth to see if it works publicly as the name implies
                'Content-Type': 'application/json'
            }
        });
        console.log("[SUCCESS]", Object.keys(res.data));
    } catch (e) {
        console.log("[FAIL]", e.response?.status, e.response?.data);
    }
}
test();
