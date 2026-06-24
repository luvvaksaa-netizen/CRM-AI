import express from 'express';
import { getOverview, getPatterns, getAnalytics, togglePattern, seedLearning, deletePattern, getPromptEvolutions, getLearnedPromptAddon } from '../controllers/learning.controller';
import { authorize } from '../middlewares/auth.middleware';

const router = express.Router();

router.get('/overview', getOverview);
router.get('/patterns', getPatterns);
router.get('/analytics', getAnalytics);
router.get('/evolutions', getPromptEvolutions);
router.get('/agent/:agent_id/learned-addon', getLearnedPromptAddon);
router.put('/patterns/:id/toggle', authorize('admin'), togglePattern);

router.post('/seed', authorize('admin'), seedLearning);
router.delete('/patterns/:id', authorize('admin'), deletePattern);

export default router;
