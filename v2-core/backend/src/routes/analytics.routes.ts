import express from 'express';
import { getOverview, getLeads, getFollowups, getLearning } from '../controllers/analytics.controller';

const router = express.Router();

router.get('/overview', getOverview);
router.get('/leads', getLeads);
router.get('/followups', getFollowups);
router.get('/learning', getLearning);

export default router;
