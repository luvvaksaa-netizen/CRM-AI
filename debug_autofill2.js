const axios = require('axios');

async function test() {
    const url = 'https://api-public.mengantar.com/api/address/autofill?keyword=kalisoro';
    try {
        const res = await axios.get(url);
        console.log(`[OK] ${url} ->`, Object.keys(res.data));
    } catch (e) {
        console.log(`[FAIL] ${url} -> ${e.response?.status}`);
    }
}
test();
