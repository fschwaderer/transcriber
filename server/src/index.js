import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import transcribeRouter from './routes/transcribe.js';
import { TranscriptionError } from './services/transcription.js';

const app = express();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 3210;

app.disable('x-powered-by');
app.use(cors({ origin: 'https://web.whatsapp.com' }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.use('/transcribe', transcribeRouter);

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return response.status(status).json({ success: false, error: error.message });
  }

  if (error instanceof TranscriptionError) {
    console.error('[TRANSCRIBER]', error.message);
    return response.status(error.statusCode).json({
      success: false,
      error: error.message
    });
  }

  console.error('[TRANSCRIBER]', 'Falha ao processar a requisição:', error.message);
  return response.status(500).json({
    success: false,
    error: 'Não foi possível transcrever o áudio.'
  });
});

app.listen(port, host, () => {
  console.log(`[TRANSCRIBER] Servidor disponível em http://${host}:${port}`);
});
