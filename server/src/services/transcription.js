import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const MOCK_TRANSCRIPTION = 'Teste de transcrição recebido com sucesso.';
const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let worker;
let requestSequence = 0;
const pendingRequests = new Map();

export class TranscriptionError extends Error {
  constructor(message, { statusCode = 500, cause } = {}) {
    super(message, { cause });
    this.name = 'TranscriptionError';
    this.statusCode = statusCode;
  }
}

function getPythonPath() {
  if (process.env.WHISPER_PYTHON) return process.env.WHISPER_PYTHON;
  return process.platform === 'win32'
    ? path.join(serverDirectory, '.venv', 'Scripts', 'python.exe')
    : path.join(serverDirectory, '.venv', 'bin', 'python');
}

function rejectPendingRequests(message) {
  for (const { reject, timeout } of pendingRequests.values()) {
    clearTimeout(timeout);
    reject(new TranscriptionError(message, { statusCode: 503 }));
  }
  pendingRequests.clear();
}

function getWorker() {
  if (worker && !worker.killed) return worker;

  const workerPath = path.join(serverDirectory, 'python', 'faster_whisper_worker.py');
  worker = spawn(getPythonPath(), ['-u', workerPath], {
    cwd: serverDirectory,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const output = readline.createInterface({ input: worker.stdout });
  output.on('line', (line) => {
    let result;
    try {
      result = JSON.parse(line);
    } catch {
      console.error('[TRANSCRIBER:WHISPER]', 'Resposta inválida do worker local.');
      return;
    }

    if (result.event === 'ready') {
      console.log('[TRANSCRIBER:WHISPER]', `Modelo ${result.model} carregado em ${result.device}.`);
      return;
    }

    const pending = pendingRequests.get(result.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingRequests.delete(result.id);
    if (result.error) {
      pending.reject(new TranscriptionError(result.error, { statusCode: 502 }));
    } else {
      pending.resolve(result.text);
    }
  });

  worker.stderr.on('data', (chunk) => {
    const message = chunk.toString().trim();
    if (message) console.log('[TRANSCRIBER:WHISPER]', message);
  });
  worker.on('error', (error) => {
    console.error('[TRANSCRIBER:WHISPER]', 'Não foi possível iniciar o worker:', error.message);
    rejectPendingRequests('Não foi possível iniciar o faster-whisper local.');
    worker = undefined;
  });
  worker.on('exit', (code) => {
    if (code !== 0) console.error('[TRANSCRIBER:WHISPER]', `Worker encerrado com código ${code}.`);
    rejectPendingRequests('O processo local de transcrição foi encerrado.');
    worker = undefined;
  });
  return worker;
}

function transcribeWithFasterWhisper({ buffer }) {
  const id = String(++requestSequence);
  const localWorker = getWorker();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new TranscriptionError('A transcrição local excedeu o tempo limite.', {
        statusCode: 504
      }));
    }, 10 * 60 * 1000);
    pendingRequests.set(id, { resolve, reject, timeout });
    localWorker.stdin.write(`${JSON.stringify({
      id,
      audio: buffer.toString('base64'),
      language: process.env.TRANSCRIPTION_LANGUAGE || 'pt'
    })}\n`);
  });
}

/**
 * Isolates the transcription provider behind one small interface.
 * Phases 1 and 2 deliberately use a deterministic mock implementation.
 */
export async function transcribeAudio({ buffer, mimetype, filename }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('O arquivo de áudio está vazio.');
  }

  if (!mimetype?.startsWith('audio/')) {
    throw new Error('O arquivo enviado não possui um tipo de áudio válido.');
  }

  const provider = (process.env.TRANSCRIPTION_PROVIDER || 'mock').toLowerCase();
  if (provider === 'mock') return MOCK_TRANSCRIPTION;
  if (provider === 'faster-whisper') return transcribeWithFasterWhisper({ buffer });

  throw new TranscriptionError(
    `Provider de transcrição não suportado: ${provider}.`,
    { statusCode: 500 }
  );
}
