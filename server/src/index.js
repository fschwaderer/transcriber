import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import transcribeRouter from './routes/transcribe.js';
import { TranscriptionError, getTranscriptionStatus, getPythonPath, updateTranscriptionSettings } from './services/transcription.js';
import { backendVersion, getSettings, getSettingsOptions, getRuntimeVersions } from './services/settings.js';
import { getEvents, recordEvent } from './services/diagnostics.js';

const app = express();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 3210;

app.disable('x-powered-by');
app.use(cors({ origin: 'https://web.whatsapp.com' }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', version: backendVersion, uptimeSeconds: Math.floor(process.uptime()), ...getTranscriptionStatus() });
});

app.get('/diagnostics', (request, response) => {
  response.json({ success: true, status: { version: backendVersion, settings: getSettings(), uptimeSeconds: Math.floor(process.uptime()), ...getTranscriptionStatus() },
    events: getEvents(Math.max(0, Number(request.query.after) || 0)) });
});

app.get('/settings', async (_request, response) => {
  response.json({ success: true, settings: getSettings(), options: getSettingsOptions(),
    versions: await getRuntimeVersions(getPythonPath()), status: getTranscriptionStatus() });
});

app.post('/settings', (request, response, next) => {
  const origin = request.get('origin');
  if (origin && origin !== 'https://web.whatsapp.com') return response.status(403).json({ success: false, error: 'Origem não permitida.' });
  if (!request.is('application/json')) return response.status(415).json({ success: false, error: 'Envie as configurações em JSON.' });
  next();
}, express.json({ limit: '4kb' }), async (request, response) => {
  const settings = await updateTranscriptionSettings(request.body);
  response.json({ success: true, settings, status: getTranscriptionStatus() });
});

app.use('/transcribe', transcribeRouter);

app.use((error, _request, response, _next) => {
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    return response.status(error.status).json({ success: false, error: 'Configurações JSON inválidas ou muito grandes.' });
  }
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return response.status(status).json({ success: false, error: error.message });
  }

  if (error instanceof TranscriptionError) {
    recordEvent('error', 'HTTP', error.message);
    return response.status(error.statusCode).json({
      success: false,
      error: error.message
    });
  }

  recordEvent('error', 'HTTP', 'Falha ao processar a requisição.', error.message);
  return response.status(500).json({
    success: false,
    error: 'Não foi possível transcrever o áudio.'
  });
});

app.listen(port, host, () => recordEvent('info', 'SERVER', `Servidor disponível em http://${host}:${port}.`));
