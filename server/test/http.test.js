import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

test('servidor inicia, informa saude e aceita audio apos instalar dependencias', async (t) => {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), TRANSCRIPTION_PROVIDER: 'mock' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });
  const url = `http://127.0.0.1:${port}`;
  let health;
  for (let i = 0; i < 100; i++) {
    try { health = await (await fetch(`${url}/health`)).json(); break; } catch {}
    if (child.exitCode !== null) assert.fail(logs);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(health?.status, 'ok', logs);
  assert.equal(health.provider, 'mock');
  const form = new FormData();
  form.set('audio', new Blob(['audio de teste'], { type: 'audio/ogg' }), 'teste.ogg');
  const response = await fetch(`${url}/transcribe`, { method: 'POST', body: form });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, text: 'Teste de transcrição recebido com sucesso.' });
  const missing = await fetch(`${url}/transcribe`, { method: 'POST', body: new FormData() });
  assert.equal(missing.status, 400);
  assert.equal((await (await fetch(`${url}/diagnostics`)).json()).success, true);
});
