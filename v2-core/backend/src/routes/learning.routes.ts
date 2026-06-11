import express from 'express';
import { getOverview, getPatterns, getAnalytics, togglePattern, seedLearning, deletePattern } from '../controllers/learning.controller';
import { authorize } from '../middlewares/auth.middleware';

const router = express.Router();

router.get('/overview', getOverview);
router.get('/patterns', getPatterns);
router.get('/analytics', getAnalytics);
router.put('/patterns/:id/toggle', authorize('admin'), togglePattern);

router.post('/seed', authorize('admin'), seedLearning);
router.delete('/patterns/:id', authorize('admin'), deletePattern);

export default router;
