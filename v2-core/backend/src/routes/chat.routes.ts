import express from 'express';
import rateLimit from 'express-rate-limit';
import { getChatHistory, getContacts, markAsRead, sendManualMessage, sendManualMediaMessage, pauseAi, unpauseAi, requestPhone, clearChat, sendReaction, forwardMessage } from '../controllers/chat.controller';
import { authenticateJWT, authorize } from '../middlewares/auth.middleware';

const router = express.Router();

// Rate limit: max 30 send message per menit per IP
// Melindungi dari spam/abuse ke endpoint kirim WA
const sendLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 menit
  max: 30,
  message: { success: false, error: 'Terlalu banyak permintaan. Coba lagi dalam 1 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/:storeId', authenticateJWT, getChatHistory);
router.get('/:storeId/contacts', authenticateJWT, getContacts);
router.post('/:storeId/:contactId/read', authenticateJWT, markAsRead);
router.post('/:storeId/send', sendLimiter, authorize('operator', 'admin'), sendManualMessage);
router.post('/:storeId/send-media', authorize('operator', 'admin'), sendManualMediaMessage);
router.post('/:storeId/:contactId/pause', authorize('operator', 'admin'), pauseAi);
router.post('/:storeId/:contactId/unpause', authorize('operator', 'admin'), unpauseAi);
router.post('/:storeId/:contactId/request-phone', authorize('operator', 'admin'), requestPhone);
router.delete('/:storeId/:contactId', authorize('admin'), clearChat);
router.post('/:storeId/messages/reaction', authorize('operator', 'admin'), sendReaction);
router.post('/:storeId/messages/forward', authorize('operator', 'admin'), forwardMessage);

export default router;
