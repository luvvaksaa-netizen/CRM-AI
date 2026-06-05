# ============================================================
# DOCKERFILE - Multi-stage build for smaller production image
# ============================================================

# --- Build stage ---
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    build-essential \
    python3 \
    python-is-python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/src/app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .

# --- Production stage ---
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV DATA_DIR=/usr/src/app/.wwebjs_auth

WORKDIR /usr/src/app

# Copy only production artifacts from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app .

# Create data directory with correct permissions
RUN mkdir -p .wwebjs_auth/uploads && \
    groupadd -r appuser && \
    useradd -r -g appuser -d /usr/src/app -s /sbin/nologin appuser && \
    chown -R appuser:appuser /usr/src/app

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["node", "index.js"]
