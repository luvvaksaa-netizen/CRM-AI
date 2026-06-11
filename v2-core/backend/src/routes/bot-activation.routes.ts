import express from 'express';
import { getStatus, toggleBot, getAllStoresStatus } from '../controllers/bot-activation.controller';
import { authorize } from '../middlewares/auth.middleware';

const router = express.Router();

router.get('/stores', getAllStoresStatus);
router.get('/:store_wa_id', getStatus);
router.post('/:store_wa_id/toggle', authorize('admin'), toggleBot);

export default router;
