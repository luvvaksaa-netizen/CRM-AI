# ============================================================
# DOCKERFILE FOR WHATSAPP AI CRM (Production Optimized)
# ============================================================
FROM node:20-slim

# 1. Install Chromium & Required Libraries for Puppeteer
#    These are the "Missing Libraries" that usually crash WA bots on Shared Hosting.
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    ffmpeg \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 2. Tell Puppeteer to use the installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 3. Create App Directory
WORKDIR /usr/src/app

# 4. Install Dependencies
COPY package*.json ./
RUN npm install --production

# 5. Copy Source Code
COPY . .

# 6. Create Persistent Directories (Ensures login sessions & uploads survive restarts)
RUN mkdir -p .wwebjs_auth \
    && mkdir -p public/uploads \
    && chmod -R 777 .wwebjs_auth public/uploads

# 7. Expose Port (3000 is our default)
EXPOSE 3000

# 8. Start the bot
CMD ["node", "index.js"]
