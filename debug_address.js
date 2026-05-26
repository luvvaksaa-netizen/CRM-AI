const axios = require('axios');
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NjY2YTI0MDVkNWM2MzRiY2JjMjEwNTAiLCJlbWFpbCI6InRva29zZXBlZGExM0BnbWFpbC5jb20iLCJ2aXNpdG9ySWQiOiIiLCJ0d29GYWN0b3JBdXRoZW50aWNhdGVkIjp0cnVlLCJ0dGlkIjoiIiwiaWF0IjoxNzc5NzA5MTg3LCJleHAiOjE3ODAzMTM5ODd9.A15IJVnoEv1X-V6jUW89UQU5wSY1JPkwkJzvWPeVnOA";

async function test() {
    const urls = [
        'https://api-public.mengantar.com/api/address?q=kalisoro',
        'https://api.mengantar.com/api/address?q=kalisoro',
        'https://api-public.mengantar.com/api/address/destination?q=kalisoro',
        'https://api.mengantar.com/api/address/destination?q=kalisoro',
        'https://api-public.mengantar.com/api/location?search=kalisoro',
        'https://api.mengantar.com/api/location?search=kalisoro'
    ];
    for (let url of urls) {
        try {
            const res = await axios.get(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
            console.log(`[OK] ${url} ->`, res.data);
            return;
        } catch (e) {
            console.log(`[FAIL] ${url} -> ${e.response?.status}`);
        }
    }
}
test();
