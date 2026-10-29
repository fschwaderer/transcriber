import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const serverDirectory = fileURLToPath(new URL('../..', import.meta.url));
const settingsFile = process.env.TRANSCRIBER_SETTINGS_FILE || path.join(serverDirectory, '.settings.json');
export const backendVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const models = ['tiny', 'base', 'small', 'medium', 'large-v3', 'large-v3-turbo'];
const languages = [
  { value: 'pt', label: 'Português' }, { value: 'auto', label: 'Detectar automaticamente' },
  { value: 'en', label: 'Inglês' }, { value: 'es', label: 'Espanhol' },
  { value: 'fr', label: 'Francês' }, { value: 'de', label: 'Alemão' }, { value: 'it', label: 'Italiano' },
];
const defaults = { model: process.env.WHISPER_MODEL || 'small', language: process.env.TRANSCRIPTION_LANGUAGE || 'pt' };
let settings = { ...defaults };

export function getSettingsOptions() {
  return {
    models: [...new Set([...models, defaults.model])].map(value => ({ value, label: value })),
    languages: languages.some(item => item.value === defaults.language)
      ? languages : [...languages, { value: defaults.language, label: defaults.language }],
  };
}

export function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['model', 'language'].includes(key))) {
    throw new Error('Informe somente modelo e idioma nas configurações.');
  }
  const next = { ...settings, ...value };
  const options = getSettingsOptions();
  if (!options.models.some(item => item.value === next.model)) throw new Error('Modelo de transcrição inválido.');
  if (!options.languages.some(item => item.value === next.language)) throw new Error('Idioma de transcrição inválido.');
  return next;
}

try {
  settings = validateSettings(JSON.parse(readFileSync(settingsFile, 'utf8')));
} catch (error) {
  if (error.code !== 'ENOENT') console.warn('[TRANSCRIBER:SETTINGS] Configuração salva inválida; usando .env.', error.message);
}

export function getSettings() { return { ...settings }; }

export function saveSettings(next) {
  const validated = validateSettings(next);
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  writeFileSync(`${settingsFile}.tmp`, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  renameSync(`${settingsFile}.tmp`, settingsFile);
  settings = validated;
  return getSettings();
}

let versionsPromise;
export function getRuntimeVersions(pythonPath) {
  if (!versionsPromise) {
    versionsPromise = promisify(execFile)(pythonPath, ['-c',
      'import sys,json,importlib.metadata as m\ntry:\n whisper=m.version("faster-whisper")\nexcept m.PackageNotFoundError:\n whisper="Não instalado"\nprint(json.dumps({"python":sys.version.split()[0],"fasterWhisper":whisper}))'],
    { timeout: 5000, windowsHide: true }).then(({ stdout }) => JSON.parse(stdout)).catch(() => ({ python: 'Indisponível', fasterWhisper: 'Indisponível' }));
  }
  return versionsPromise.then(versions => ({ backend: backendVersion, node: process.versions.node, ...versions }));
}
