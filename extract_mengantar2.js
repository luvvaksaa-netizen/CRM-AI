const axios = require('axios');
const fs = require('fs');

async function extract() {
    const { data: html } = await axios.get('https://app.mengantar.com');
    const scriptUrls = [...html.matchAll(/src="([^"]+\.js)"/g)].map(m => m[1]);
    
    let allStrings = new Set();
    for (let url of scriptUrls) {
        if (url.startsWith('/')) url = 'https://app.mengantar.com' + url;
        try {
            const { data: js } = await axios.get(url);
            // Match any string that starts with / and has at least one more slash
            const matches = js.match(/(["'])\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9./_-]+\1/g);
            if (matches) {
                matches.forEach(m => allStrings.add(m.replace(/["']/g, '')));
            }
        } catch(e) {}
    }
    
    const sorted = Array.from(allStrings).sort();
    fs.writeFileSync('mengantar_paths.txt', sorted.join('\n'));
}
extract();
