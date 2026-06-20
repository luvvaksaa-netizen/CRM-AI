import express from 'express';
import {
  handleWebhook,
  createOrderHandler,
  getOrderHandler,
  listProductsHandler,
  getConfigHandler,
  updateConfigHandler,
} from '../controllers/scalev.controller';
import { authorize } from '../middlewares/auth.middleware';

const router = express.Router();

// ─── Admin: Order Management ───
router.post('/orders', authorize('admin'), createOrderHandler);
router.get('/orders/:orderId', authorize('admin'), getOrderHandler);

// ─── Admin: Produk & Katalog ───
router.get('/products', authorize('admin'), listProductsHandler);

// ─── Config ───
router.get('/config', getConfigHandler);
router.put('/config', authorize('admin'), updateConfigHandler);

export default router;
