import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getMediaAssets, getMediaById, uploadMedia, updateMedia, deleteMedia } from '../controllers/media.controller';

const router = express.Router();

const UPLOADS_DIR = path.resolve(__dirname, '../../data/uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/3gpp'
];

function fileFilter(req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (ALLOWED_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipe file ${file.mimetype} tidak diizinkan. Gunakan: ${ALLOWED_MIMES.join(', ')}`));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

router.get('/', getMediaAssets);
router.post('/upload', upload.single('file'), uploadMedia);
router.get('/:id', getMediaById);
router.put('/:id', updateMedia);
router.delete('/:id', deleteMedia);

export default router;
