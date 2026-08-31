import { Router } from 'express';
import multer from 'multer';
import { transcribeAudio } from '../services/transcription.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    callback(null, file.mimetype.startsWith('audio/'));
  }
});

router.post('/', upload.single('audio'), async (request, response, next) => {
  try {
    if (!request.file) {
      return response.status(400).json({
        success: false,
        error: 'Envie um arquivo de áudio no campo "audio".'
      });
    }

    const text = await transcribeAudio({
      buffer: request.file.buffer,
      mimetype: request.file.mimetype,
      filename: request.file.originalname
    });

    return response.json({ success: true, text });
  } catch (error) {
    return next(error);
  }
});

export default router;
