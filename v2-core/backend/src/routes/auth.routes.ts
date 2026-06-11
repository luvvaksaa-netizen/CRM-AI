import express from 'express';
import { login, getSession } from '../controllers/auth.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Menit
  max: 10,
  message: 'Terlalu banyak percobaan login. Silakan coba lagi nanti (15 menit).',
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', loginLimiter, login);
router.get('/session', authenticateJWT, getSession);

export default router;
