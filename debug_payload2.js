const axios = require('axios');

async function test() {
    const url = 'https://api-public.mengantar.com/api/order/allEstimatePublic?origin_id=5fc62f5df8f44b34aa4c0d8c&destination_id=Kalisoro&weight=1&COD_AMOUNT=123';

    try {
        const res = await axios.get(url);
        console.log("[SUCCESS]", Object.keys(res.data));
    } catch (e) {
        console.log("[FAIL]", e.response?.status, e.response?.data);
    }
}
test();
