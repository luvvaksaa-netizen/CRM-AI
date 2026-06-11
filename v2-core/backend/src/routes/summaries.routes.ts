import express from 'express';
import { getAll, getById, getLabelSummary } from '../controllers/summaries.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';

const router = express.Router();

router.get('/', authenticateJWT, getAll);
router.get('/labels', authenticateJWT, getLabelSummary);
router.get('/:storeWaId/:contactId', authenticateJWT, getById);

export default router;
