import express from 'express';
import {
  getLabels,
  getAllLabelCounts,
  getWaLabelsList,
  updateContactLabels,
  syncContactLabels,
  createLabel,
  editLabel,
  deleteLabel,
  getColorPalette,
} from '../controllers/smart-label.controller';

const router = express.Router();

router.get('/counts', getAllLabelCounts);
router.get('/:storeWaId/wa-list', getWaLabelsList);
router.get('/:storeWaId/color-palette', getColorPalette);
router.post('/:storeWaId/:contactId/sync', syncContactLabels);
router.post('/:storeWaId/:contactId/update', updateContactLabels);
router.get('/:storeWaId/:contactId', getLabels);
router.post('/:storeWaId/create', createLabel);
router.put('/:storeWaId/:labelId', editLabel);
router.delete('/:storeWaId/:labelId', deleteLabel);

export default router;
