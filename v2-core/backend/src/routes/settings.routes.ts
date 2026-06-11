import express from 'express';
import {
  getStoreSettings,
  updateStoreSettings,
  getHealth,
  downloadLogs,
  getBackups,
  createBackup,
  deleteBackup,
  downloadBackup,
  getWAStatus,
  restartWA,
  updateProfile,
} from '../controllers/settings.controller';
import { authorize } from '../middlewares/auth.middleware';

const router = express.Router();

// ─── System Health (specific routes FIRST — before :storeId) ───
router.get('/health', getHealth);
router.get('/logs', downloadLogs);

// ─── Database Backups ───
router.get('/backups', getBackups);
router.post('/backups', authorize('admin'), createBackup);
router.delete('/backups/:name', authorize('admin'), deleteBackup);
router.get('/backups/:name/download', downloadBackup);

// ─── WA Engine ───
router.get('/wa-status', getWAStatus);
router.post('/wa-restart', authorize('admin'), restartWA);

// ─── Admin Profile ───
router.put('/profile', authorize('admin'), updateProfile);

// ─── Legacy store settings (parameterized route LAST) ───
router.get('/:storeId', getStoreSettings);
router.post('/:storeId', authorize('admin'), updateStoreSettings);

export default router;
