# ============================================================
# DOCKERFILE FOR WHATSAPP AI CRM (Final GLIBC Fix)
# ============================================================
FROM node:20-bookworm

# 1. Install Dependencies Sistem dengan Tool Kompilasi Lengkap
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    build-essential \
    python3 \
    python-is-python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 2. Konfigurasi Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 3. Direktori Kerja
WORKDIR /usr/src/app

# Set DATA_DIR agar mengarah langsung ke Volume Railway Anda yang sudah terpasang
ENV DATA_DIR=/usr/src/app/.wwebjs_auth

# 4. Install Dependencies & PAKSA BUILD DARI SOURCE
# Ini adalah kunci untuk mengatasi error GLIBC
COPY package*.json ./
RUN npm install --build-from-source sqlite3

# 5. Install sisa package lainnya
RUN npm install

# 6. Copy Source Code
COPY . .

# 7. Persiapan Folder Data & Volume Lock
RUN mkdir -p .wwebjs_auth/uploads && chmod -R 777 .wwebjs_auth

# 8. Expose & Start
EXPOSE 3000
CMD ["node", "index.js"]
