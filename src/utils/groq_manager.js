const OpenAI = require('openai');
const config = require('../config');
const logger = require('./logger');

class GroqManager {
    constructor() {
        this.keys = config.GROQ_API_KEYS || [];
        this.clients = [];
        this.currentIndex = 0;
        this.isAvailable = this.keys.length > 0;
        
        if (this.isAvailable) {
            // Inisialisasi klien OpenAI yang mengarah ke endpoint Groq
            this.clients = this.keys.map(key => {
                return new OpenAI({
                    apiKey: key,
                    baseURL: 'https://api.groq.com/openai/v1',
                    maxRetries: 0 // Kita tangani retry manual untuk rotasi
                });
            });
            logger.info(`[Groq] Diinisialisasi dengan ${this.keys.length} API keys untuk rotasi.`);
        }
    }

    /**
     * Mendapatkan instance client Groq saat ini untuk round-robin.
     */
    getClient() {
        if (!this.isAvailable) return null;
        
        const client = this.clients[this.currentIndex];
        // Pindah ke index selanjutnya untuk distribusi beban (Round-Robin sederhana)
        this.currentIndex = (this.currentIndex + 1) % this.clients.length;
        return client;
    }

    /**
     * Mengeksekusi panggilan API dengan rotasi otomatis jika terkena rate limit (429).
     * Jika semua key Groq gagal/habis limit, akan melempar error agar bisa di-fallback ke OpenAI asli.
     * 
     * @param {Function} apiCall - Fungsi async yang menerima `client` (OpenAI instance)
     * @returns {Promise<any>} Hasil eksekusi API
     */
    async executeWithRotation(apiCall) {
        if (!this.isAvailable) {
            throw new Error("GROQ_UNAVAILABLE");
        }

        let lastError;
        let startIdx = this.currentIndex;
        let attempts = 0;
        let maxAttempts = this.clients.length;

        while (attempts < maxAttempts) {
            const client = this.clients[this.currentIndex];
            const currentKeyIdx = this.currentIndex;
            
            // Advance index for next call or retry
            this.currentIndex = (this.currentIndex + 1) % this.clients.length;
            
            try {
                // Eksekusi API
                return await apiCall(client);
            } catch (error) {
                lastError = error;
                // Status 429 = Rate Limit atau Insufficient Quota
                if (error.status === 429 || (error.message && error.message.includes('429'))) {
                    logger.warn(`[Groq] Key index ${currentKeyIdx} terkena Rate Limit (429). Mencoba key berikutnya...`);
                    attempts++;
                    continue;
                } else if (error.status >= 500) {
                    logger.warn(`[Groq] Key index ${currentKeyIdx} mengalami Server Error (${error.status}). Mencoba key berikutnya...`);
                    attempts++;
                    continue;
                } else {
                    // Error lain (seperti 400 Bad Request, invalid prompt, dll) langsung throw, jangan dirotasi
                    throw error;
                }
            }
        }

        // Jika sampai di sini, berarti semua key Groq gagal (kemungkinan besar karena 429 semua)
        logger.error(`[Groq] Semua ${maxAttempts} API key gagal dieksekusi (Habis limit/Error). Memicu Fallback ke OpenAI.`);
        throw new Error("GROQ_ALL_KEYS_EXHAUSTED");
    }
}

// Export singleton instance
module.exports = new GroqManager();
