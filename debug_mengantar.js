const axios = require('axios');

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NjY2YTI0MDVkNWM2MzRiY2JjMjEwNTAiLCJlbWFpbCI6InRva29zZXBlZGExM0BnbWFpbC5jb20iLCJ2aXNpdG9ySWQiOiIiLCJ0d29GYWN0b3JBdXRoZW50aWNhdGVkIjp0cnVlLCJ0dGlkIjoiIiwiaWF0IjoxNzc5NzA5MTg3LCJleHAiOjE3ODAzMTM5ODd9.A15IJVnoEv1X-V6jUW89UQU5wSY1JPkwkJzvWPeVnOA";

const endpoints = [
    'https://api-public.mengantar.com/api/location/search?q=kalisoro',
    'https://api-public.mengantar.com/api/destination/search?q=kalisoro',
    'https://api-public.mengantar.com/api/region/search?q=kalisoro',
    'https://api-public.mengantar.com/api/district/search?q=kalisoro',
    'https://api-public.mengantar.com/api/subdistrict/search?q=kalisoro',
    'https://api.mengantar.com/api/location/search?q=kalisoro',
    'https://api.mengantar.com/api/destination/search?q=kalisoro',
    'https://api-public.mengantar.com/api/location?search=kalisoro',
    'https://api-public.mengantar.com/api/destination?search=kalisoro',
    'https://api-public.mengantar.com/api/location?q=kalisoro',
    'https://api-public.mengantar.com/api/region?q=kalisoro',
    'https://api-public.mengantar.com/api/location/origin?q=kalisoro',
    'https://api-public.mengantar.com/api/location/destination?q=kalisoro',
    'https://api.mengantar.com/api/location?q=kalisoro'
];

async function testEndpoints() {
    console.log("Testing Mengantar endpoints...");
    for (const url of endpoints) {
        try {
            const res = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${TOKEN}`,
                    'Accept': 'application/json, text/plain, */*'
                }
            });
            console.log(`[SUCCESS] ${url} ->`, Object.keys(res.data));
            if (res.data.data) {
                 console.log("Data sample:", res.data.data.slice(0, 2));
                 return; // Found it!
            }
        } catch (e) {
            console.log(`[FAIL] ${url} -> ${e.response?.status}`);
        }
    }
}

testEndpoints();
