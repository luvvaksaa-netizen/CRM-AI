const axios = require('axios');
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NjY2YTI0MDVkNWM2MzRiY2JjMjEwNTAiLCJlbWFpbCI6InRva29zZXBlZGExM0BnbWFpbC5jb20iLCJ2aXNpdG9ySWQiOiIiLCJ0d29GYWN0b3JBdXRoZW50aWNhdGVkIjp0cnVlLCJ0dGlkIjoiIiwiaWF0IjoxNzc5NzA5MTg3LCJleHAiOjE3ODAzMTM5ODd9.A15IJVnoEv1X-V6jUW89UQU5wSY1JPkwkJzvWPeVnOA";

async function test() {
    const urls = [
        'https://api-public.mengantar.com/api/order/autofill?keyword=kalisoro',
        'https://api-public.mengantar.com/api/address/autofill?keyword=kalisoro',
        'https://api-public.mengantar.com/api/autofill?keyword=kalisoro'
    ];
    for (let url of urls) {
        try {
            const res = await axios.get(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
            console.log(`[OK] ${url} ->`, Object.keys(res.data));
            if (res.data.data) {
                console.log(JSON.stringify(res.data.data).substring(0, 200));
            }
            return;
        } catch (e) {
            console.log(`[FAIL] ${url} -> ${e.response?.status}`);
        }
    }
}
test();
