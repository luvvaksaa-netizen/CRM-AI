import express from 'express';
import { getOverview, getLeads, getClosing, getFollowups, getLearning } from '../controllers/analytics.controller';

const router = express.Router();

router.get('/overview', getOverview);
router.get('/leads', getLeads);
router.get('/closing', getClosing);
router.get('/followups', getFollowups);
router.get('/learning', getLearning);

export default router;
