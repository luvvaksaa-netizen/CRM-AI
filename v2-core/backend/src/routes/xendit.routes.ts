import express from 'express';
import {
  getTransactions,
  getStats,
  createNewInvoice,
  getQrStatusHandler,
  getInvoiceStatus,
  expireInvoiceHandler,
  getBalance,
  forceSync,
  getConfig,
  updateConfig,
} from '../controllers/xendit.controller';
import { authorize } from '../middlewares/auth.middleware';

const router = express.Router();

// ─── Payment Transactions ───
router.get('/transactions', getTransactions);
router.get('/transactions/stats', getStats);

// ─── QRIS Dinamis (endpoint utama untuk NON-COD) ───
router.post('/qris', authorize('admin'), createNewInvoice);
router.get('/qr-status/:referenceId', getQrStatusHandler);

// ─── Invoice (backward compat / admin manual) ───
router.post('/invoice', authorize('admin'), createNewInvoice);  // alias ke qris
router.get('/invoice/:externalId', getInvoiceStatus);
router.post('/invoice/:externalId/expire', authorize('admin'), expireInvoiceHandler);

// ─── Utility ───
router.get('/balance', getBalance);
router.post('/sync', authorize('admin'), forceSync);
router.get('/config', getConfig);
router.put('/config', authorize('admin'), updateConfig);

export default router;
