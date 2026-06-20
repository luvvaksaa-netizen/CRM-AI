import express from 'express';
import {
  getAddresses,
  getOrders,
  createOrder,
  getConfig,
  updateConfig
} from '../controllers/mengantar.controller';
import { authorize } from '../middlewares/auth.middleware';

const router = express.Router();

router.get('/addresses', authorize(), getAddresses);
router.get('/orders', authorize(), getOrders);
router.post('/create-order', authorize(), createOrder);
router.get('/config', authorize('admin'), getConfig);
router.put('/config', authorize('admin'), updateConfig);

export default router;
