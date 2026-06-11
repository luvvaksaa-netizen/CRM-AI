import express from 'express';
import {
  getAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  getAgentMedia,
} from '../controllers/agent.controller';
import { authorize } from '../middlewares/auth.middleware';

const router = express.Router();

router.get('/', getAgents);
router.post('/', authorize('admin'), createAgent);
router.put('/:id', authorize('admin'), updateAgent);
router.delete('/:id', authorize('admin'), deleteAgent);
router.get('/:id/media', getAgentMedia);

export default router;
