import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { recordEvent } from './diagnostics.js';
import { getSettings, saveSettings, validateSettings } from './settings.js';

const MOCK_TRANSCRIPTION = 'Teste de transcrição recebido com sucesso.';
const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let worker;
let settingsUpdating = false;
let expectedWorkerExit;
let requestSequence = 0;
const pendingRequests = new Map();
const workerState = { status: 'stopped', model: getSettings().model, device: process.env.WHISPER_DEVICE || 'cpu',
  computeType: process.env.WHISPER_COMPUTE_TYPE || 'int8', cpuThreads: Number(process.env.WHISPER_CPU_THREADS) || 0,
  startedAt: null, readyAt: null, lastError: null };

export class TranscriptionError extends Error {
  constructor(message, { statusCode = 500, cause } = {}) { super(message, { cause }); this.name = 'TranscriptionError'; this.statusCode = statusCode; }
}

export function getTranscriptionStatus() {
  const provider = (process.env.TRANSCRIPTION_PROVIDER || 'mock').toLowerCase();
  return { provider, worker: provider === 'faster-whisper' ? { ...workerState } : { status: 'not-required' }, pendingRequests: pendingRequests.size };
}

export function getPythonPath() {
  if (process.env.WHISPER_PYTHON) return process.env.WHISPER_PYTHON;
  return process.platform === 'win32' ? path.join(serverDirectory, '.venv', 'Scripts', 'python.exe') : path.join(serverDirectory, '.venv', 'bin', 'python');
}

export async function updateTranscriptionSettings(value) {
  let next;
  try { next = validateSettings(value); }
  catch (error) { throw new TranscriptionError(error.message, { statusCode: 400 }); }
  if (settingsUpdating || pendingRequests.size || workerState.status === 'loading') {
    throw new TranscriptionError('Aguarde as transcrições em andamento antes de alterar as configurações.', { statusCode: 409 });
  }
  settingsUpdating = true;
  try {
    if (worker && next.model !== getSettings().model) {
      const currentWorker = worker;
      expectedWorkerExit = currentWorker;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Não foi possível encerrar o modelo anterior. Tente novamente.')), 5000);
        currentWorker.once('close', () => { clearTimeout(timeout); resolve(); });
        if (process.platform === 'win32') {
          // O executavel do venv pode ter um processo Python filho no Windows.
          execFile('taskkill.exe', ['/PID', String(currentWorker.pid), '/T', '/F'], { windowsHide: true }, error => {
            if (error && currentWorker.exitCode === null) {
              clearTimeout(timeout); expectedWorkerExit = undefined; reject(error);
            }
          });
        } else currentWorker.kill();
      });
    }
    const saved = saveSettings(next);
    Object.assign(workerState, { model: saved.model, lastError: null });
    if (!worker) Object.assign(workerState, { status: 'stopped', startedAt: null, readyAt: null });
    recordEvent('info', 'SETTINGS', `Configurações salvas: modelo ${saved.model}, idioma ${saved.language}.`);
    return saved;
  } catch (error) {
    recordEvent('error', 'SETTINGS', 'Falha ao salvar configurações.', error.message);
    throw new TranscriptionError('Não foi possível salvar as configurações. Verifique os logs do backend.', { cause: error });
  } finally { settingsUpdating = false; }
}

function rejectPendingRequests(message) {
  for (const { reject, timeout } of pendingRequests.values()) { clearTimeout(timeout); reject(new TranscriptionError(message, { statusCode: 503 })); }
  pendingRequests.clear();
}

function getWorker() {
  if (worker && !worker.killed) return worker;
  worker = spawn(getPythonPath(), ['-u', path.join(serverDirectory, 'python', 'faster_whisper_worker.py')], { cwd: serverDirectory,
    env: { ...process.env, WHISPER_MODEL: getSettings().model }, stdio: ['pipe', 'pipe', 'pipe'] });
  const currentWorker = worker;
  Object.assign(workerState, { status: 'loading', startedAt: new Date().toISOString(), readyAt: null, lastError: null });
  recordEvent('info', 'WHISPER', `Iniciando worker e carregando o modelo ${workerState.model}.`);
  readline.createInterface({ input: worker.stdout }).on('line', (line) => {
    let result;
    try { result = JSON.parse(line); } catch { recordEvent('error', 'WHISPER', 'Resposta inválida do worker local.', line); return; }
    if (result.event === 'ready') {
      Object.assign(workerState, { status: 'ready', model: result.model, device: result.device, readyAt: new Date().toISOString() });
      recordEvent('info', 'WHISPER', `Modelo ${result.model} carregado em ${result.device}.`); return;
    }
    const pending = pendingRequests.get(result.id);
    if (!pending) return;
    clearTimeout(pending.timeout); pendingRequests.delete(result.id);
    if (result.error) { recordEvent('error', 'WHISPER', `Transcrição ${result.id} falhou.`, result.error); pending.reject(new TranscriptionError(result.error, { statusCode: 502 })); }
    else { recordEvent('info', 'WHISPER', `Transcrição ${result.id} concluída.`); pending.resolve(result.text); }
  });
  worker.stderr.on('data', (chunk) => { const message = chunk.toString().trim(); if (message) recordEvent('info', 'WHISPER', message); });
  worker.on('error', (error) => {
    if (worker !== currentWorker) return;
    Object.assign(workerState, { status: 'error', lastError: error.message }); recordEvent('error', 'WHISPER', 'Não foi possível iniciar o worker.', error.message);
    rejectPendingRequests('Não foi possível iniciar o faster-whisper local.'); worker = undefined;
  });
  worker.on('exit', (code) => {
    if (worker !== currentWorker) return;
    if (expectedWorkerExit === currentWorker) {
      expectedWorkerExit = undefined;
      workerState.status = 'stopped'; worker = undefined;
      return;
    }
    workerState.status = code === 0 ? 'stopped' : 'error';
    if (code !== 0) { workerState.lastError = `Worker encerrado com código ${code}.`; recordEvent('error', 'WHISPER', workerState.lastError); }
    rejectPendingRequests('O processo local de transcrição foi encerrado.'); worker = undefined;
  });
  worker.stdin.on('error', error => {
    if (worker !== currentWorker) return;
    workerState.lastError = error.message;
    rejectPendingRequests('A conexão com o motor local foi encerrada. Tente novamente.');
  });
  return worker;
}

function transcribeWithFasterWhisper({ buffer }) {
  const id = String(++requestSequence); const localWorker = getWorker();
  recordEvent('info', 'QUEUE', `Transcrição ${id} recebida (${Math.round(buffer.length / 1024)} KB).`);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pendingRequests.delete(id); recordEvent('error', 'QUEUE', `Transcrição ${id} excedeu o tempo limite.`); reject(new TranscriptionError('A transcrição local excedeu o tempo limite.', { statusCode: 504 })); }, 10 * 60 * 1000);
    pendingRequests.set(id, { resolve, reject, timeout });
    localWorker.stdin.write(`${JSON.stringify({ id, audio: buffer.toString('base64'), language: getSettings().language })}\n`);
  });
}

export async function transcribeAudio({ buffer, mimetype }) {
  if (settingsUpdating) throw new TranscriptionError('Configurações sendo atualizadas. Tente novamente em instantes.', { statusCode: 503 });
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('O arquivo de áudio está vazio.');
  if (!mimetype?.startsWith('audio/')) throw new Error('O arquivo enviado não possui um tipo de áudio válido.');
  const provider = (process.env.TRANSCRIPTION_PROVIDER || 'mock').toLowerCase();
  if (provider === 'mock') return MOCK_TRANSCRIPTION;
  if (provider === 'faster-whisper') return transcribeWithFasterWhisper({ buffer });
  throw new TranscriptionError(`Provider de transcrição não suportado: ${provider}.`, { statusCode: 500 });
}
