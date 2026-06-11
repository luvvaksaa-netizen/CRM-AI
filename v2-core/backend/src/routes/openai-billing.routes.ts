import express from 'express';
import {
  getLatest,
  getHistory,
  fetchNow,
  getConfig,
  updateConfig,
  testTelegram,
  getActualCosts,
  getExchangeRate,
} from '../controllers/openai-billing.controller';
import { authorize } from '../middlewares/auth.middleware';

const router = express.Router();

router.get('/latest', getLatest);
router.get('/history', getHistory);
router.post('/fetch', authorize('admin'), fetchNow);
router.get('/config', getConfig);
router.put('/config', authorize('admin'), updateConfig);
router.post('/test-telegram', authorize('admin'), testTelegram);
router.get('/actual-costs', getActualCosts);
router.get('/exchange-rate', getExchangeRate);

export default router;
