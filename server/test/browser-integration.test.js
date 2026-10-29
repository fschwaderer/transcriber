import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const ui = readFileSync(new URL('../../browser/whatsapp-transcriber.user.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../../browser/whatsapp-transcriber-wa-bridge.user.js', import.meta.url), 'utf8');

function install(t, { includeBridge = true, stuckHistory = false, failDragging = false, settingsMissing = false, settingsConflict = false, backendOffline = false, workerStatus = 'stopped' } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://web.whatsapp.com/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const page = dom.window;
  const timers = new Map();
  const errors = [];
  const progress = [];
  let sequence = 0, calls = 0, downloads = 0, uploads = 0;
  let configuration = { model: 'small', language: 'pt' };
  const saves = [];
  const status = () => ({ version: '0.2.0', settings: configuration, worker: { status: workerStatus, model: configuration.model, device: 'cpu', computeType: 'int8' }, pendingRequests: 0, uptimeSeconds: 60 });
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
      if (backendOffline) { options.onerror(); return; }
      if (options.url.endsWith('/settings')) {
        if (settingsMissing) { options.onload({ status: 404, response: {} }); return; }
        if (options.method === 'POST') {
          saves.push(JSON.parse(options.data));
          if (settingsConflict) { options.onload({ status: 409, response: { success: false, error: 'Aguarde as transcrições em andamento.' } }); return; }
          configuration = JSON.parse(options.data);
        }
        options.onload({ status: 200, response: { success: true, settings: configuration, status: status(),
          options: { models: ['tiny', 'small', 'large-v3'].map(value => ({ value, label: value })),
            languages: [{ value: 'pt', label: 'Português' }, { value: 'auto', label: 'Automático' }] },
          versions: { backend: '0.2.0', node: '22.test', python: '3.13.test', fasterWhisper: '1.2.1' },
        } });
        return;
      }
      if (options.url.includes('/diagnostics')) {
        options.onload({ status: 200, response: { success: true, status: status(), events: [] } });
        return;
      }
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
    saves,
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

test('engrenagem centraliza configuracoes, status e versoes e salva modelo e idioma', async t => {
  const app = install(t);
  assert.equal(app.find('#wat-actions').querySelectorAll('button').length, 4);
  app.find('#wat-settings-toggle').click();
  await app.flush();
  assert.equal(app.find('#wat-settings').hidden, false);
  assert.equal(app.find('#wat-settings-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(app.find('#wat-model').value, 'small');
  assert.equal(app.find('#wat-python-version').textContent, '3.13.test');
  assert.equal(app.find('#wat-whisper-version').textContent, '1.2.1');
  assert.match(app.find('#wat-device').textContent, /cpu.*int8/);
  app.find('#wat-model').value = 'tiny'; app.find('#wat-language').value = 'auto';
  const form = app.find('#wat-settings-form');
  form.dispatchEvent(new form.ownerDocument.defaultView.Event('change', { bubbles: true }));
  form.dispatchEvent(new form.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await app.flush();
  assert.deepEqual(app.saves, [{ model: 'tiny', language: 'auto' }]);
  assert.equal(app.find('#wat-current-model').textContent, 'tiny');
  assert.match(app.find('#wat-settings-message').textContent, /Configurações salvas/);
  app.find('#wat-settings-close').click();
  assert.equal(app.find('#wat-settings').hidden, true);
  assert.equal(app.find('#wat-settings-toggle').getAttribute('aria-expanded'), 'false');
});

test('cabecalho mostra exportacao apos reposicionar e status completo no indicador verde', async t => {
  const app = install(t);
  await app.flush();
  const buttons = [...app.find('#wat-actions').querySelectorAll('button')].map(button => button.id);
  assert.deepEqual(buttons, ['wat-reset-position', 'wat-export-toggle', 'wat-settings-toggle', 'wat-toggle']);
  assert.ok(app.find('#wat-export-toggle svg'));
  assert.equal(app.find('#wat-export-toggle').getAttribute('aria-label'), 'Exportar conversa');
  assert.equal(app.find('#wat-summary'), null);
  const dot = app.find('#wat-system-status');
  const page = dot.ownerDocument.defaultView;
  assert.equal(dot.parentElement.id, 'wat-heading');
  assert.equal(dot.dataset.state, 'online');
  assert.equal(page.getComputedStyle(dot).backgroundColor, 'rgb(25, 135, 84)');
  dot.dispatchEvent(new page.MouseEvent('mouseenter'));
  await app.flush();
  assert.match(dot.title, /Sistema conectado/);
  assert.match(dot.title, /ponte pronta/);
  assert.match(dot.title, /Modelo: small/);
  assert.match(dot.title, /Python: 3.13.test/);
  assert.match(dot.title, /Solicitações pendentes: 0/);
  app.find('#wat-toggle').click();
  assert.notEqual(page.getComputedStyle(dot).display, 'none');
  app.find('#wat-export-toggle').click();
  assert.equal(app.find('#wat-export-layer').hidden, false);
});

for (const [name, options, expected] of [
  ['backend offline', { backendOffline: true }, /Backend desconectado/],
  ['ponte ausente', { includeBridge: false }, /ponte sem resposta/],
  ['erro no motor', { workerStatus: 'error' }, /Erro no motor/],
]) {
  test(`indicador fica vermelho com ${name}`, async t => {
    const app = install(t, options);
    await app.flush();
    app.fire(5000); await app.flush();
    const dot = app.find('#wat-system-status');
    assert.equal(dot.dataset.state, 'offline');
    assert.equal(dot.ownerDocument.defaultView.getComputedStyle(dot).backgroundColor, 'rgb(220, 53, 69)');
    assert.match(dot.title, expected);
  });
}

test('reposicionar volta ao cabecalho e funciona mesmo com falha no arraste', t => {
  const app = install(t, { failDragging: true });
  const panel = app.find('#wat-panel');
  const reset = app.find('#wat-reset-position');
  assert.equal(reset.parentElement.id, 'wat-actions');
  panel.style.left = '140px'; panel.style.top = '200px'; panel.style.right = 'auto';
  reset.click();
  assert.equal(panel.style.left, '');
  assert.equal(panel.style.top, '');
  assert.equal(panel.style.right, '');
});

test('configuracoes e exportacao abrem centralizadas fora do painel movel', async t => {
  const app = install(t);
  app.find('#wat-panel').style.left = '20px';
  app.find('#wat-toggle').click();
  app.find('#wat-settings-toggle').click(); await app.flush();
  const layer = app.find('#wat-settings-layer');
  const page = layer.ownerDocument.defaultView;
  assert.equal(layer.parentElement.tagName, 'BODY');
  assert.equal(page.getComputedStyle(layer).position, 'fixed');
  assert.equal(page.getComputedStyle(layer).placeItems, 'center');
  assert.equal(app.find('#wat-settings').getAttribute('role'), 'dialog');
  assert.equal(app.find('#wat-settings').getAttribute('aria-modal'), 'true');
  assert.equal(app.find('#wat-panel').classList.contains('wat-collapsed'), true);
  app.find('#wat-settings-close').click();
  app.find('#wat-toggle').click();
  app.find('#wat-export-toggle').click();
  assert.equal(app.find('#wat-settings-layer').hidden, true);
  assert.equal(app.find('#wat-export-layer').hidden, false);
  assert.equal(app.find('#wat-export-layer').parentElement.tagName, 'BODY');
  assert.equal(page.getComputedStyle(app.find('#wat-export-layer')).position, 'fixed');
  app.find('#wat-export-load').click(); await app.flush();
  const status = app.find('#wat-export-status').textContent;
  app.find('#wat-export-close').dispatchEvent(new page.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(app.find('#wat-export-layer').hidden, true);
  assert.equal(page.document.activeElement.id, 'wat-export-toggle');
  app.find('#wat-export-toggle').click();
  assert.equal(app.find('#wat-export-status').textContent, status, 'Fechar nao perde mensagens carregadas');
});

test('painel central mantem foco e fecha pelo fundo sem apagar conteudo', async t => {
  const app = install(t);
  app.find('#wat-export-toggle').click();
  const page = app.find('#wat-export').ownerDocument.defaultView;
  const close = app.find('#wat-export-close');
  close.dispatchEvent(new page.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(page.document.activeElement.id, 'wat-export-html');
  app.find('#wat-export-html').dispatchEvent(new page.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(page.document.activeElement, close);
  app.find('#wat-export-layer').click();
  assert.equal(app.find('#wat-export').hidden, true);
  assert.equal(page.document.activeElement.id, 'wat-export-toggle');
});

test('conflito de transcricao preserva modelo atual e mostra erro nas configuracoes', async t => {
  const app = install(t, { settingsConflict: true });
  app.find('#wat-settings-toggle').click(); await app.flush();
  app.find('#wat-model').value = 'tiny';
  const form = app.find('#wat-settings-form');
  form.dispatchEvent(new form.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  await app.flush();
  assert.match(app.find('#wat-settings-message').textContent, /Aguarde as transcrições/);
  assert.equal(app.find('#wat-current-model').textContent, 'small');
  assert.equal(app.find('#wat-settings-save').disabled, false);
});

test('backend antigo orienta reiniciar e desabilita gravacao de configuracoes', async t => {
  const app = install(t, { settingsMissing: true });
  app.find('#wat-settings-toggle').click(); await app.flush();
  assert.match(app.find('#wat-settings-message').textContent, /Reinicie o backend/);
  assert.equal(app.find('#wat-settings-save').disabled, true);
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
