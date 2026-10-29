import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

test('configuracoes persistem, validam entradas e trocam o worker sem interromper audio', async t => {
  const python = process.env.WHISPER_PYTHON || 'python';
  try { execFileSync(python, ['--version'], { windowsHide: true }); }
  catch { t.skip('Python necessario para testar o protocolo real do worker'); return; }
  const temporary = await mkdtemp(path.join(tmpdir(), 'transcriber-settings-'));
  const settingsFile = path.join(temporary, 'settings.json');
  // Substitui somente a biblioteca: testa o worker Python real sem baixar modelos.
  await writeFile(path.join(temporary, 'faster_whisper.py'), `
import time
from types import SimpleNamespace
class WhisperModel:
    def __init__(self, model, **kwargs): self.model = model
    def transcribe(self, audio, language=None, **kwargs):
        time.sleep(0.3)
        return [SimpleNamespace(text=self.model + ':' + str(language))], None
`);
  let child;
  let logs = '';
  let url;
  async function start() {
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    child = spawn(process.execPath, ['src/index.js'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), TRANSCRIPTION_PROVIDER: 'faster-whisper',
        WHISPER_MODEL: 'small', TRANSCRIPTION_LANGUAGE: 'pt', WHISPER_PYTHON: python,
        PYTHONPATH: temporary, TRANSCRIBER_SETTINGS_FILE: settingsFile },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
    url = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
      try { await fetch(`${url}/health`); return; } catch {}
      if (child.exitCode !== null) assert.fail(logs);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail(logs);
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    if (process.platform === 'win32') {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else child.kill();
    await exited;
  }
  t.after(async () => { await stop(); await rm(temporary, { recursive: true, force: true }); });
  const configure = settings => fetch(`${url}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
  const transcribe = () => {
    const form = new FormData(); form.set('audio', new Blob(['teste'], { type: 'audio/ogg' }), 'teste.ogg');
    return fetch(`${url}/transcribe`, { method: 'POST', body: form });
  };
  await start();
  let config = await (await fetch(`${url}/settings`)).json();
  assert.equal(config.settings.model, 'small');
  assert.ok(config.options.models.some(model => model.value === 'large-v3-turbo'));
  assert.match(config.versions.node, /^\d+\./);
  assert.equal((await configure({ model: 'arbitrario' })).status, 400);
  assert.equal((await configure({ model: 'base', device: 'cuda' })).status, 400);
  assert.equal((await fetch(`${url}/settings`, { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await configure({ model: 'base', language: 'auto' })).status, 200);
  const first = transcribe();
  let busy = false;
  for (let i = 0; i < 100; i++) {
    if ((await (await fetch(`${url}/health`)).json()).pendingRequests) { busy = true; break; }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(busy);
  assert.equal((await configure({ model: 'tiny' })).status, 409);
  assert.equal((await (await first).json()).text, 'base:None');
  assert.equal((await configure({ model: 'tiny', language: 'es' })).status, 200);
  assert.equal((await (await transcribe()).json()).text, 'tiny:es');
  assert.equal((await (await fetch(`${url}/health`)).json()).worker.model, 'tiny');
  assert.deepEqual(JSON.parse(await readFile(settingsFile, 'utf8')), { model: 'tiny', language: 'es' });
  await stop(); await start();
  config = await (await fetch(`${url}/settings`)).json();
  assert.deepEqual(config.settings, { model: 'tiny', language: 'es' });
});
