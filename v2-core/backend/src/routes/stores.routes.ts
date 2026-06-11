import express from 'express';
import { getAllStores, createStore, prepareQR, cancelQR, updateStore, deleteStore, logoutStore, reconnectStore, getWAStatus } from '../controllers/stores.controller';
import { authenticateJWT, authorize } from '../middlewares/auth.middleware';

const router = express.Router();

router.get('/', authenticateJWT, getAllStores);
router.get('/status', authenticateJWT, getWAStatus);
router.post('/', authenticateJWT, authorize('admin'), createStore);
router.post('/prepare-qr', authenticateJWT, authorize('admin'), prepareQR);
router.post('/cancel-qr', authenticateJWT, authorize('admin'), cancelQR);
router.put('/:id', authenticateJWT, authorize('admin'), updateStore);
router.delete('/:id', authenticateJWT, authorize('admin'), deleteStore);
router.post('/:id/logout', authenticateJWT, authorize('admin'), logoutStore);
router.post('/:id/reconnect', authenticateJWT, authorize('admin'), reconnectStore);

export default router;
