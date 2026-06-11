/**
 * @file constants.js
 * @description Centralized constants and configuration for the bot.
 */

module.exports = {
  // AI Configuration
  AI: {
    MODEL: 'gpt-4o-mini', // Menggunakan GPT-4o-mini (Cepat & Murah)
    SYSTEM_PROMPT: `
Kamu adalah Customer Service yang ramah, profesional, dan sedikit santai. 
Tugasmu adalah membantu pelanggan. Gunakan bahasa Indonesia sehari-hari yang sopan. 
Jika kamu tidak tahu jawabannya, katakan dengan sopan bahwa kamu akan mengeceknya ke tim terkait.
    `.trim(),
  },

  // WhatsApp Configuration
  WHATSAPP: {
    CLIENT_NAME: 'WA-AI-CS-Bot',
    TYPING_DELAY_PER_CHAR: 50, // milliseconds per character to simulate typing
    MAX_TYPING_DELAY: 3000,    // maximum typing delay in ms
  },

  // Error Messages
  ERRORS: {
    AI_FALLBACK: "Mohon maaf Kak, sistem kami sedang sedikit kendala. Tunggu sebentar ya, saya sedang mencoba lagi. 🙏",
  }
};
