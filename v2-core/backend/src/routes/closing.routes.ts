import express from 'express';
import { getStats, getPatterns, getAnalytics, togglePatternActive, deletePattern, exportCsv } from '../controllers/closing.controller';
import { authenticateJWT, authorize } from '../middlewares/auth.middleware';

const router = express.Router();

router.get('/stats', authenticateJWT, getStats);
router.get('/patterns', authenticateJWT, getPatterns);
router.get('/analytics', authenticateJWT, getAnalytics);
router.put('/patterns/:id/toggle', authorize('admin'), togglePatternActive);
router.delete('/patterns/:id', authorize('admin'), deletePattern);
router.get('/export/csv', authenticateJWT, exportCsv);

export default router;
