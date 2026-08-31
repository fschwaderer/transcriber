// ==UserScript==
// @name         WhatsApp Audio Transcriber
// @namespace    whatsapp-audio-transcriber
// @version      0.2.5
// @description  Envia áudios recebidos no WhatsApp Web para transcrição local.
// @match        https://web.whatsapp.com/*
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  'use strict';

  const API_URL = 'http://127.0.0.1:3210/transcribe';
  const DEBUG = true;
  const processedMessages = new Set();
  const transcriptionQueue = [];
  let processingQueue = false;
  const pendingDownloads = new Map();

  const log = (scope, ...args) => {
    if (DEBUG) console.log(`[TRANSCRIBER${scope ? `:${scope}` : ''}]`, ...args);
  };

  function createPanel() {
    const style = document.createElement('style');
    style.textContent = `
      #wat-panel { position: fixed; right: 18px; top: 76px; z-index: 999999;
        display: flex; flex-direction: column; width: min(360px, calc(100vw - 36px));
        max-height: calc(100vh - 94px); overflow: hidden;
        color: #e9edef; background: #202c33; border: 1px solid #374248; border-radius: 12px;
        box-shadow: 0 6px 22px rgba(0,0,0,.35); font: 14px/1.4 Arial, sans-serif; }
      #wat-title { flex: 0 0 auto; display: flex; align-items: center;
        justify-content: space-between; padding: 10px 14px; font-weight: 600;
        background: #202c33; border-bottom: 1px solid #374248; }
      #wat-actions { display: flex; align-items: center; gap: 6px; }
      #wat-clear, #wat-toggle { padding: 4px 8px; color: #aebac1; background: transparent;
        border: 1px solid #53616a; border-radius: 6px; cursor: pointer; font-size: 12px; }
      #wat-toggle { min-width: 28px; font-size: 16px; line-height: 16px; }
      #wat-clear:hover, #wat-toggle:hover { color: #e9edef; background: #2a3942; }
      #wat-list { overflow-y: auto; }
      #wat-panel.wat-collapsed #wat-list { display: none; }
      #wat-panel.wat-collapsed #wat-title { border-bottom: 0; }
      #wat-list:empty::after { content: 'Aguardando novos áudios…'; display: block;
        padding: 14px; color: #8696a0; }
      .wat-item { padding: 12px 14px; border-bottom: 1px solid #374248; }
      .wat-item:last-child { border-bottom: 0; }
      .wat-contact { margin-bottom: 4px; color: #e9edef; font-weight: 700; }
      .wat-status { color: #00a884; font-weight: 600; }
      .wat-text { margin-top: 7px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .wat-meta { margin-top: 5px; color: #8696a0; font-size: 12px; }
      .wat-retry { margin-top: 8px; padding: 6px 10px; color: #111b21; background: #00a884;
        border: 0; border-radius: 7px; cursor: pointer; }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.id = 'wat-panel';
    panel.innerHTML = `
      <div id="wat-title">
        <span>🎤 Transcrição</span>
        <div id="wat-actions">
          <button id="wat-toggle" type="button" title="Minimizar painel" aria-expanded="true">−</button>
          <button id="wat-clear" type="button" title="Limpar transcrições">Limpar</button>
        </div>
      </div>
      <div id="wat-list"></div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('#wat-clear').addEventListener('click', () => {
      panel.querySelector('#wat-list').replaceChildren();
      log('', 'Painel limpo');
    });
    const toggle = panel.querySelector('#wat-toggle');
    toggle.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('wat-collapsed');
      toggle.textContent = collapsed ? '+' : '−';
      toggle.title = collapsed ? 'Expandir painel' : 'Minimizar painel';
      toggle.setAttribute('aria-expanded', String(!collapsed));
    });
    return panel.querySelector('#wat-list');
  }

  const list = createPanel();
  log('', 'Interface iniciada; aguardando a ponte WA-JS');

  function formatDuration(seconds) {
    const value = Number(seconds) || 0;
    return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  }

  function createQueueItem(message, fullId) {
    const element = document.createElement('article');
    element.className = 'wat-item';
    element.innerHTML = `
      <div class="wat-contact"></div>
      <div class="wat-status">🎤 Áudio recebido · Na fila</div>
      <div class="wat-text"></div>
      <div class="wat-meta">Áudio: ${formatDuration(message.duration)}</div>
    `;
    element.querySelector('.wat-contact').textContent = message.contactName || 'Contato desconhecido';
    list.append(element);
    list.scrollTop = list.scrollHeight;
    return { message, fullId, element };
  }

  function setItemState(item, status, text = '', canRetry = false) {
    const statusElement = item.element.querySelector('.wat-status');
    const textElement = item.element.querySelector('.wat-text');
    if (!statusElement || !textElement) return;
    statusElement.textContent = status;
    textElement.textContent = text;
    item.element.querySelector('.wat-retry')?.remove();

    if (canRetry) {
      const button = document.createElement('button');
      button.className = 'wat-retry';
      button.type = 'button';
      button.textContent = 'Tentar novamente';
      button.addEventListener('click', () => {
        button.remove();
        setItemState(item, '🎤 Áudio recebido · Na fila');
        transcriptionQueue.push(item);
        void processQueue();
      }, { once: true });
      item.element.appendChild(button);
    }
  }

  async function sendToBackend(blob) {
    const formData = new FormData();
    formData.append('audio', blob, `audio-${Date.now()}.ogg`);
    log('API', 'Enviando áudio ao backend');

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: API_URL,
        data: formData,
        responseType: 'json',
        timeout: 10 * 60 * 1000,
        onload: (response) => {
          let result = response.response;
          if (typeof result === 'string') {
            try {
              result = JSON.parse(result);
            } catch {
              result = {};
            }
          }

          if (response.status < 200 || response.status >= 300 || !result?.success) {
            reject(new Error(result?.error || `Backend respondeu com HTTP ${response.status}`));
            return;
          }
          resolve(result.text);
        },
        ontimeout: () => reject(new TypeError('Tempo limite ao acessar o backend local')),
        onerror: () => reject(new TypeError('Não foi possível acessar o backend local'))
      });
    });
  }

  async function processItem(item) {
    setItemState(item, '⏳ Transcrevendo...');
    log('WA', 'Baixando mídia', item.fullId);
    const blob = await requestMediaDownload(item.fullId);
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error('Mídia vazia ou indisponível');
    const text = await sendToBackend(blob);
    setItemState(item, '📝 Transcrição', text);
    log('QUEUE', 'Transcrição concluída', item.fullId);
  }

  async function processQueue() {
    if (processingQueue) return;
    processingQueue = true;
    try {
      while (transcriptionQueue.length > 0) {
        const item = transcriptionQueue.shift();
        try {
          await processItem(item);
        } catch (error) {
          const offline = error instanceof TypeError;
          const status = offline
            ? '⚠ Serviço de transcrição offline'
            : '⚠ Não foi possível transcrever';
          setItemState(item, status, offline ? '' : error.message, true);
          log('QUEUE', 'Falha no processamento', item.fullId, error.message);
        }
      }
    } finally {
      processingQueue = false;
    }
  }

  function requestMediaDownload(fullId) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingDownloads.delete(requestId);
        reject(new Error('Tempo limite ao baixar o áudio do WhatsApp'));
      }, 30000);
      pendingDownloads.set(requestId, { resolve, reject, timeout });
      window.postMessage({ source: 'wat-ui', action: 'download', requestId, fullId }, '*');
    });
  }

  window.addEventListener('message', (event) => {
    if (event.data?.source !== 'wat-wa-bridge') return;

    if (event.data.action === 'ready') {
      log('WA', `Bridge pronto (${event.data.version ?? 'versão desconhecida'})`);
      return;
    }

    if (event.data.action === 'new-audio') {
      const { fullId, duration, type, contactName } = event.data;
      if (!fullId || processedMessages.has(fullId)) return;
      processedMessages.add(fullId);
      log('WA', 'Áudio detectado', fullId);
      transcriptionQueue.push(createQueueItem({ duration, type, contactName }, fullId));
      void processQueue();
      return;
    }

    if (event.data.action === 'download-result') {
      const pending = pendingDownloads.get(event.data.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingDownloads.delete(event.data.requestId);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.blob);
    }
  });

  window.postMessage({ source: 'wat-ui', action: 'status' }, '*');
})();
