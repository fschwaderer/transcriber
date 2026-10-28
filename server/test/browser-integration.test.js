import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const ui = readFileSync(new URL('../../browser/whatsapp-transcriber.user.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../../browser/whatsapp-transcriber-wa-bridge.user.js', import.meta.url), 'utf8');

function install(t, { includeBridge = true, stuckHistory = false, failDragging = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://web.whatsapp.com/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const page = dom.window;
  const timers = new Map();
  const errors = [];
  const progress = [];
  let sequence = 0, calls = 0, downloads = 0, uploads = 0;
  const setTimer = (callback, ms) => {
    const id = ++sequence;
    timers.set(id, { callback, ms });
    return id;
  };
  const clearTimer = id => timers.delete(id);
  page.setTimeout = setTimer;
  page.clearTimeout = clearTimer;
  page.console = { log() {}, warn() {}, error() {} };
  page.addEventListener('error', event => errors.push(event.error));
  page.document.addEventListener('wat-wa-response', event => {
    const data = JSON.parse(event.detail);
    if (data.action === 'request-progress') progress.push(data.message);
  });
  page.postMessage = data => queueMicrotask(() => {
    if (page.closed) return;
    page.dispatchEvent(new page.MessageEvent('message', { data, source: page, origin: page.location.origin }));
  });
  page.WPP = {
    version: 'test', loader: { onReady(callback) { callback(); } }, on() {},
    contact: { get: async () => ({ name: 'Cliente' }) },
    chat: {
      async downloadMedia() {
        downloads++;
        return new page.Blob(['audio de teste'], { type: 'audio/ogg' });
      },
      getActiveChat: () => ({ id: '123@c.us', name: 'Cliente' }),
      getMessages() {
        calls++;
        if (stuckHistory) return new Promise(() => {});
        return Promise.resolve([
          { id: 'false_123@c.us_audio', type: 'ptt', t: 100, duration: 12 },
          { id: 'false_123@c.us_text', type: 'chat', t: 101, body: 'Mensagem de texto' },
        ]);
      },
    },
  };
  // A janela vista pelo userscript com grants e diferente da janela da pagina.
  // postMessage entrega source=page; o canal DOM deve funcionar mesmo assim.
  const sandboxWindow = {
    addEventListener: page.addEventListener.bind(page),
    postMessage: page.postMessage,
  };
  if (includeBridge) page.eval(bridge);
  vm.runInNewContext(ui, {
    window: sandboxWindow, document: page.document, CustomEvent: page.CustomEvent,
    console: page.console, crypto: page.crypto, Blob: page.Blob, URL: page.URL,
    FormData: page.FormData, setTimeout: setTimer, clearTimeout: clearTimer,
    setInterval() {}, clearInterval() {}, atob: page.atob.bind(page),
    GM_xmlhttpRequest(options) {
      if (options.method !== 'POST') return;
      uploads++;
      const audio = options.data.get('audio');
      assert.equal(audio.size, 14);
      assert.equal(audio.type, 'audio/ogg');
      options.onload({ status: 200, response: { success: true, text: 'Transcricao confirmada' } });
    },
    ResizeObserver: class {
      constructor() { if (failDragging) throw new Error('Arraste indisponivel'); }
      observe() {}
    },
  });
  t.after(() => {
    assert.deepEqual(errors, [], 'Nenhuma excecao deve interromper a interface');
    dom.window.close();
  });
  return {
    find: selector => page.document.querySelector(selector),
    calls: () => calls,
    downloads: () => downloads,
    uploads: () => uploads,
    progress,
    async flush() { await new Promise(resolve => setImmediate(resolve)); },
    fire(ms) {
      for (const [id, timer] of [...timers]) {
        if (timer.ms !== ms) continue;
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

test('buscas recebem respostas entre contextos isolados sem duplicar consultas', async t => {
  const app = install(t, { failDragging: true });
  app.find('#wat-history-search').click();
  await app.flush();
  assert.equal(app.find('#wat-history-list').querySelectorAll('input').length, 1);
  assert.equal(app.find('#wat-history-search').disabled, false);
  assert.match(app.find('#wat-wa-status').textContent, /ponte pronta \(0\.4\.2\)/);
  app.find('#wat-export-load').click();
  await app.flush();
  assert.match(app.find('#wat-export-status').textContent, /2 mensagem/);
  assert.equal(app.calls(), 2, 'Cada busca deve consultar o WhatsApp apenas uma vez');
  assert.ok(app.progress.some(message => message.includes('Consultando o histórico')));
});

test('audio selecionado atravessa contextos e e transcrito uma unica vez', async t => {
  const app = install(t);
  app.find('#wat-history-search').click();
  await app.flush();
  const checkbox = app.find('#wat-history-list input');
  checkbox.checked = true;
  checkbox.dispatchEvent(new checkbox.ownerDocument.defaultView.Event('change', { bubbles: true }));
  app.find('#wat-history-submit').click();
  for (let i = 0; i < 50 && !app.uploads(); i++) await app.flush();
  assert.equal(app.downloads(), 1);
  assert.equal(app.uploads(), 1);
  assert.match(app.find('#wat-list').textContent, /Transcricao confirmada/);
});

test('ponte ausente encerra buscas e libera botoes em cinco segundos', async t => {
  const app = install(t, { includeBridge: false });
  app.find('#wat-history-search').click();
  app.find('#wat-export-load').click();
  app.fire(5000);
  await app.flush();
  assert.match(app.find('#wat-history-status').textContent, /ponte não respondeu/i);
  assert.match(app.find('#wat-export-status').textContent, /ponte não respondeu/i);
  assert.equal(app.find('#wat-history-search').disabled, false);
  assert.equal(app.find('#wat-export-load').disabled, false);
});

test('WhatsApp sem resposta informa etapa, encerra buscas e libera botoes', async t => {
  const app = install(t, { stuckHistory: true });
  app.find('#wat-history-search').click();
  app.find('#wat-export-load').click();
  await app.flush();
  assert.match(app.find('#wat-history-status').textContent, /Consultando o histórico/);
  app.fire(5000); // Recebimento ja confirmado: o prazo de conexao nao deve abortar.
  await app.flush();
  assert.equal(app.find('#wat-history-search').disabled, true);
  app.fire(20000);
  await app.flush();
  assert.match(app.find('#wat-history-status').textContent, /WhatsApp não respondeu/);
  assert.match(app.find('#wat-export-status').textContent, /WhatsApp não respondeu/);
  assert.equal(app.find('#wat-history-search').disabled, false);
  assert.equal(app.find('#wat-export-load').disabled, false);
});
