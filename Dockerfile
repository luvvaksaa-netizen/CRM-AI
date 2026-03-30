# ============================================================
# DOCKERFILE FOR WHATSAPP AI CRM (Fix GLIBC & SQLite)
# ============================================================
FROM node:20

# 1. Install Dependencies Sistem (Chrome, FFmpeg & Build Tools)
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# 2. Konfigurasi Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 3. Direktori Kerja
WORKDIR /usr/src/app

# 4. Install Dependencies
# Kita hapus node_modules lama (jika ada) dan install ulang di dalam Docker
COPY package*.json ./
RUN npm cache clean --force && npm install

# 5. Copy Source Code
COPY . .

# 6. Folder Absolut untuk Persistensi
RUN mkdir -p .wwebjs_auth \
    && mkdir -p public/uploads \
    && chmod -R 777 .wwebjs_auth public/uploads

# 7. Port
EXPOSE 3000

# 8. Start
CMD ["node", "index.js"]
