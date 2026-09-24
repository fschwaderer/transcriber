// ==UserScript==
// @name         WhatsApp Audio Transcriber
// @namespace    whatsapp-audio-transcriber
// @version      0.4.2
// @description  Envia áudios recebidos no WhatsApp Web para transcrição local.
// @match        https://web.whatsapp.com/*
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  'use strict';

  const API_URL = 'http://127.0.0.1:3210/transcribe';
  const DIAGNOSTICS_URL = 'http://127.0.0.1:3210/diagnostics';
  const DEBUG = true;
  const processedMessages = new Set();
  const transcriptionQueue = [];
  let processingQueue = false;
  const pendingDownloads = new Map();
  const queueItems = new Map();
  const historyAudios = new Map();
  let historyPage = null;
  let historyRequest = null;
  let lastEventId = 0;
  let lastServerUptime = 0;

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
      #wat-title { flex: 0 0 auto; display: flex; flex-direction: column; gap: 5px;
        padding: 8px 10px; font-weight: 600; cursor: grab; user-select: none; touch-action: none;
        background: #202c33; border-bottom: 1px solid #374248; }
      #wat-title-row { display: flex; align-items: center; min-width: 0; }
      #wat-heading { flex: 1; min-width: 0; font-size: 13px; white-space: nowrap; }
      #wat-actions { display: flex; align-items: center; gap: 4px; }
      #wat-connection { display: flex; align-items: center; gap: 5px; min-width: 0;
        color: #8696a0; font-size: 11px; font-weight: 400; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis; }
      #wat-connection::before { content: ''; flex: 0 0 auto; width: 7px; height: 7px;
        border-radius: 50%; background: #8696a0; }
      #wat-connection.online::before { background: #00a884; box-shadow: 0 0 0 3px rgba(0,168,132,.15); }
      #wat-connection.offline::before { background: #f15c6d; }
      #wat-panel.wat-dragging #wat-title { cursor: grabbing; }
      #wat-clear, #wat-toggle, #wat-logs-toggle, #wat-reset-position { height: 25px; padding: 2px 6px; color: #aebac1;
        background: transparent; border: 1px solid #46545d; border-radius: 5px;
        cursor: pointer; font-size: 11px; line-height: 18px; }
      #wat-clear, #wat-toggle, #wat-reset-position { width: 25px; padding: 2px; font-size: 14px; }
      #wat-clear:hover, #wat-toggle:hover, #wat-logs-toggle:hover, #wat-reset-position:hover { color: #e9edef; background: #2a3942; }
      #wat-list { overflow-y: auto; min-height: 0; flex: 1 1 auto; }
      #wat-panel.wat-collapsed #wat-list { display: none; }
      #wat-panel.wat-collapsed #wat-diagnostics { display: none; }
      #wat-panel.wat-collapsed #wat-connection { display: none; }
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
      #wat-diagnostics { display: none; flex: 0 0 auto; max-height: 210px; overflow-y: auto;
        padding: 9px 12px; border-top: 1px solid #374248; background: #111b21;
        font: 11px/1.45 Consolas, monospace; color: #aebac1; }
      #wat-diagnostics.open { display: block; }
      .wat-log { margin-bottom: 5px; overflow-wrap: anywhere; }
      .wat-log.error { color: #ff8a97; }
      #wat-manual { padding: 8px 10px; border-bottom: 1px solid #374248; flex: 0 0 auto; }
      #wat-history-heading { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
      #wat-history-controls { display: flex; }
      #wat-history-body { height: var(--wat-search-height, 260px); max-height: max(80px, calc(100vh - 310px)); overflow-y: auto; }
      #wat-history-body[hidden] { display: none; }
      #wat-panel.wat-collapsed #wat-manual { display: none; }
      #wat-manual button { margin: 3px 3px 3px 0; padding: 6px 8px; border: 1px solid #46545d;
        border-radius: 5px; background: #2a3942; color: #e9edef; cursor: pointer; }
      #wat-manual button:disabled { opacity: .5; cursor: default; }
      #wat-history-status { font-size: 12px; color: #aebac1; white-space: pre-wrap; overflow-wrap: anywhere; }
      #wat-history-list { min-height: 0; }
      .wat-choice { display: flex; gap: 8px; padding: 7px 0; border-bottom: 1px solid #374248; font-size: 12px; }
      .wat-choice input { flex: 0 0 auto; }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.id = 'wat-panel';
    panel.innerHTML = `
      <div id="wat-title" title="Arraste para mover o painel">
        <div id="wat-title-row">
          <span id="wat-heading">🎤 Transcritor</span>
          <div id="wat-actions">
            <button id="wat-reset-position" type="button" title="Voltar à posição original" aria-label="Voltar à posição original">↺</button>
            <button id="wat-logs-toggle" type="button" title="Ver diagnóstico">Logs</button>
            <button id="wat-clear" type="button" title="Limpar transcrições" aria-label="Limpar transcrições">⌫</button>
            <button id="wat-toggle" type="button" title="Minimizar painel" aria-label="Minimizar painel" aria-expanded="true">−</button>
          </div>
        </div>
        <span id="wat-connection" title="Estado do backend local">Verificando…</span>
      </div>
      <div id="wat-manual">
        <div id="wat-history-heading">
          <strong>Busca de áudios</strong>
          <div id="wat-history-controls">
            <button id="wat-history-smaller" type="button" aria-label="Reduzir altura da busca" title="Reduzir altura da busca">−</button>
            <button id="wat-history-larger" type="button" aria-label="Aumentar altura da busca" title="Aumentar altura da busca">+</button>
            <button id="wat-history-toggle" type="button" aria-controls="wat-history-body" aria-expanded="true">Recolher</button>
          </div>
        </div>
        <div id="wat-history-body">
        <button id="wat-history-search" type="button">Buscar áudios da conversa</button>
        <div id="wat-history-status" role="status" aria-live="polite"></div>
        <div id="wat-history-list"></div>
        <button id="wat-history-more" type="button" hidden>Buscar mais antigos</button>
        <button id="wat-history-submit" type="button" disabled>Transcrever selecionados (0)</button>
        </div>
      </div>
      <div id="wat-list"></div>
      <div id="wat-diagnostics" aria-live="polite"></div>
    `;
    document.body.appendChild(panel);
    setupPanelDragging(panel);
    const historyBody = panel.querySelector('#wat-history-body');
    const historyToggle = panel.querySelector('#wat-history-toggle');
    const smaller = panel.querySelector('#wat-history-smaller');
    const larger = panel.querySelector('#wat-history-larger');
    let searchHeight = 260;
    const updateSearchSize = () => {
      historyBody.style.setProperty('--wat-search-height', `${searchHeight}px`);
      historyToggle.textContent = historyBody.hidden ? 'Expandir' : 'Recolher';
      historyToggle.setAttribute('aria-expanded', String(!historyBody.hidden));
      smaller.disabled = historyBody.hidden || searchHeight <= 140;
      larger.disabled = !historyBody.hidden && searchHeight >= 620;
    };
    historyToggle.addEventListener('click', () => {
      historyBody.hidden = !historyBody.hidden;
      updateSearchSize();
    });
    smaller.addEventListener('click', () => {
      searchHeight = Math.max(140, searchHeight - 60);
      updateSearchSize();
    });
    larger.addEventListener('click', () => {
      historyBody.hidden = false;
      searchHeight = Math.min(620, searchHeight + 60);
      updateSearchSize();
    });
    updateSearchSize();
    panel.querySelector('#wat-history-search').addEventListener('click', () => searchHistory(false));
    panel.querySelector('#wat-history-more').addEventListener('click', () => searchHistory(true));
    panel.querySelector('#wat-history-list').addEventListener('change', updateHistorySelection);
    panel.querySelector('#wat-history-submit').addEventListener('click', () => {
      let count = 0;
      for (const { message, checkbox } of historyAudios.values()) {
        if (checkbox.checked && !checkbox.disabled && enqueueAudio(message, true)) count++;
      }
      updateHistorySelection();
      document.querySelector('#wat-history-status').textContent = `${count} áudio(s) enviado(s) para a fila.`;
      void processQueue();
    });
    panel.querySelector('#wat-clear').addEventListener('click', () => {
      panel.querySelector('#wat-list').replaceChildren();
      log('', 'Painel limpo');
    });
    const toggle = panel.querySelector('#wat-toggle');
    panel.querySelector('#wat-logs-toggle').addEventListener('click', () => {
      panel.querySelector('#wat-diagnostics').classList.toggle('open');
    });
    toggle.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('wat-collapsed');
      toggle.textContent = collapsed ? '+' : '−';
      toggle.title = collapsed ? 'Expandir painel' : 'Minimizar painel';
      toggle.setAttribute('aria-expanded', String(!collapsed));
    });
    return panel.querySelector('#wat-list');
  }

  function setupPanelDragging(panel) {
    const handle = panel.querySelector('#wat-title');
    let drag = null;
    let moved = false;

    function setPosition(left, top) {
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(0, document.documentElement.clientWidth - rect.width);
      const maxTop = Math.max(0, document.documentElement.clientHeight - rect.height);
      panel.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
      panel.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
      panel.style.right = 'auto';
    }

    function keepInView() {
      if (!moved) return;
      const rect = panel.getBoundingClientRect();
      setPosition(rect.left, rect.top);
    }

    function stopDragging(event) {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      const { pointerId } = drag;
      drag = null;
      panel.classList.remove('wat-dragging');
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    }

    handle.addEventListener('pointerdown', (event) => {
      if (drag || !event.isPrimary || event.button !== 0 || event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add('wat-dragging');
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      moved = true;
      setPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    });
    handle.addEventListener('pointerup', stopDragging);
    handle.addEventListener('pointercancel', stopDragging);
    handle.addEventListener('lostpointercapture', stopDragging);
    window.addEventListener('blur', () => stopDragging());
    window.addEventListener('resize', keepInView);
    new ResizeObserver(keepInView).observe(panel);

    panel.querySelector('#wat-reset-position').addEventListener('click', () => {
      stopDragging();
      moved = false;
      panel.style.removeProperty('left');
      panel.style.removeProperty('top');
      panel.style.removeProperty('right');
    });
  }

  const list = createPanel();
  log('', 'Interface iniciada; aguardando a ponte WA-JS');

  function updateHistorySelection() {
    let count = 0;
    for (const { message, checkbox } of historyAudios.values()) {
      const item = queueItems.get(message.fullId);
      checkbox.disabled = !!item && !item.canRetry;
      if (checkbox.disabled) checkbox.checked = false;
      if (checkbox.checked) count++;
    }
    const button = document.querySelector('#wat-history-submit');
    button.disabled = count === 0;
    button.textContent = `Transcrever selecionados (${count})`;
  }

  function enqueueAudio(message, manual = false) {
    const { fullId } = message;
    if (!fullId) return false;
    let item = queueItems.get(fullId);
    if (processedMessages.has(fullId)) {
      if (!manual || !item?.canRetry) return false;
      if (!item.element.isConnected) list.append(item.element);
      setItemState(item, '🎤 Áudio recebido · Na fila');
    } else {
      processedMessages.add(fullId);
      item = createQueueItem(message, fullId);
      queueItems.set(fullId, item);
    }
    transcriptionQueue.push(item);
    updateHistorySelection();
    return true;
  }

  function searchHistory(older) {
    if (historyRequest || (older && !historyPage?.hasMore)) return;
    if (!older) {
      historyPage = null;
      historyAudios.clear();
      document.querySelector('#wat-history-list').replaceChildren();
      document.querySelector('#wat-history-more').hidden = true;
      updateHistorySelection();
    }
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => finishHistory({ requestId,
      error: 'A busca demorou demais. Verifique se os dois scripts estão atualizados e se o WhatsApp terminou de carregar.' }), 30000);
    historyRequest = { requestId, timeout };
    document.querySelector('#wat-history-search').disabled = true;
    document.querySelector('#wat-history-more').disabled = true;
    document.querySelector('#wat-history-status').textContent = 'Buscando áudios recebidos…';
    window.postMessage({ source: 'wat-ui', action: 'history', requestId,
      chatId: older ? historyPage.chatId : undefined,
      before: older ? historyPage.before : undefined }, '*');
  }

  function finishHistory(result) {
    if (result.requestId !== historyRequest?.requestId) return;
    clearTimeout(historyRequest.timeout);
    historyRequest = null;
    document.querySelector('#wat-history-search').disabled = false;
    document.querySelector('#wat-history-more').disabled = false;
    const status = document.querySelector('#wat-history-status');
    if (result.error) {
      status.textContent = result.error;
      return;
    }
    historyPage = result;
    for (const message of result.audios) {
      if (historyAudios.has(message.fullId)) continue;
      const label = document.createElement('label');
      label.className = 'wat-choice';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      const text = document.createElement('span');
      const date = message.timestamp ? new Date(message.timestamp * 1000).toLocaleString('pt-BR') : 'Data indisponível';
      text.textContent = `${message.contactName} · ${date} · ${formatDuration(message.duration)}`;
      label.append(checkbox, text);
      document.querySelector('#wat-history-list').append(label);
      historyAudios.set(message.fullId, { message, checkbox });
    }
    status.textContent = `${result.chatName}: ${historyAudios.size} áudio(s) encontrado(s).\n` +
      (result.hasMore ? 'Busca em lotes de 100 mensagens. Use Buscar mais antigos para continuar.' : 'Fim do histórico disponível.') +
      '\nÁudios já na fila ou concluídos nesta sessão ficam desabilitados.';
    document.querySelector('#wat-history-more').hidden = !result.hasMore;
    updateHistorySelection();
  }

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
    item.canRetry = canRetry;
    updateHistorySelection();
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

  function gmRequest(options) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      ...options,
      responseType: 'json',
      onload: resolve,
      ontimeout: () => reject(new TypeError('Tempo limite ao acessar o backend local')),
      onerror: () => reject(new TypeError('Não foi possível acessar o backend local'))
    }));
  }

  async function refreshDiagnostics() {
    const indicator = document.querySelector('#wat-connection');
    const diagnostics = document.querySelector('#wat-diagnostics');
    try {
      const response = await gmRequest({ method: 'GET', url: `${DIAGNOSTICS_URL}?after=${lastEventId}`, timeout: 3000 });
      const result = typeof response.response === 'string' ? JSON.parse(response.response) : response.response;
      if (response.status !== 200 || !result?.success) throw new Error('Resposta de diagnóstico inválida');
      if (lastServerUptime && result.status.uptimeSeconds < lastServerUptime) lastEventId = 0;
      lastServerUptime = result.status.uptimeSeconds;
      const worker = result.status.worker;
      const workerLabel = worker.status === 'loading' ? ' · modelo carregando' :
        worker.status === 'ready' ? ` · ${worker.model} pronto` : worker.status === 'error' ? ' · worker com erro' : '';
      indicator.textContent = `Backend conectado${workerLabel}`;
      indicator.className = 'online';
      for (const event of result.events || []) {
        lastEventId = Math.max(lastEventId, event.id);
        const line = document.createElement('div');
        line.className = `wat-log ${event.level}`;
        const time = new Date(event.timestamp).toLocaleTimeString('pt-BR');
        line.textContent = `${time} [${event.scope}] ${event.message}${event.details ? ` — ${event.details}` : ''}`;
        diagnostics.append(line);
      }
      while (diagnostics.children.length > 100) diagnostics.firstElementChild.remove();
      diagnostics.scrollTop = diagnostics.scrollHeight;
    } catch (error) {
      indicator.textContent = 'Backend desconectado';
      indicator.className = 'offline';
    }
  }

  void refreshDiagnostics();
  setInterval(refreshDiagnostics, 5000);

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
    setItemState(item, '⬇ Baixando áudio do WhatsApp...');
    log('WA', 'Baixando mídia', item.fullId);
    const blob = await requestMediaDownload(item.fullId);
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error('Mídia vazia ou indisponível');
    setItemState(item, '⬆ Enviando ao backend...');
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setItemState(item, `⏳ Transcrevendo no Whisper · ${elapsed}s`);
    }, 1000);
    let text;
    try {
      text = await sendToBackend(blob);
    } finally {
      clearInterval(timer);
    }
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
      enqueueAudio(event.data);
      void processQueue();
      return;
    }

    if (event.data.action === 'history-result') {
      finishHistory(event.data);
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
