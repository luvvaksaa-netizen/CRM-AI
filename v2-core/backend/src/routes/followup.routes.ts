import express from 'express';
import { getStats, getAll, cancelFollowUp, emergencyCancelAll, getConfig, updateConfig, getPipeline, updatePipeline, forceSendNow, scheduleManual, getStageStats } from '../controllers/followup.controller';
import { authorize } from '../middlewares/auth.middleware';

const router = express.Router();

router.get('/stats/:storeId', getStats);
router.get('/:storeId', getAll);
router.post('/cancel/:id', authorize('operator', 'admin'), cancelFollowUp);
router.post('/emergency-cancel-all', authorize('admin'), emergencyCancelAll);
router.get('/config/:id', authorize('operator', 'admin'), getConfig);
router.post('/config/:id', authorize('admin'), updateConfig);

// 4-Stage Pipeline Management
router.get('/pipeline/:id', authorize('operator', 'admin'), getPipeline);
router.put('/pipeline/:id', authorize('admin'), updatePipeline);
router.get('/stage-stats/:store_wa_id', getStageStats);
router.post('/force-send/:id', authorize('admin'), forceSendNow);
router.post('/schedule', authorize('operator', 'admin'), scheduleManual);

export default router;
