// ==UserScript==
// @name         WhatsApp Audio Transcriber
// @namespace    whatsapp-audio-transcriber
// @version      0.4.8
// @description  Envia áudios recebidos no WhatsApp Web para transcrição local.
// @match        https://web.whatsapp.com/*
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  "use strict";

  const API_URL = "http://127.0.0.1:3210/transcribe";
  const DIAGNOSTICS_URL = "http://127.0.0.1:3210/diagnostics";
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
    if (DEBUG) console.log(`[TRANSCRIBER${scope ? `:${scope}` : ""}]`, ...args);
  };

  // ============================================================
  // CAMADAS DINÂMICAS — TRANSCRIBER x FAUSTO TOOLKIT
  // ============================================================

  function bringTranscriberToFront() {
    const panel = document.querySelector("#wat-panel");

    if (panel) {
      panel.style.zIndex = "2147483647";
    }

    const toolkitHost = document.getElementById("fausto-toolkit-host");
    const toolkitShadow = toolkitHost?.shadowRoot;

    const toolkitPanel = toolkitShadow?.querySelector(".painel");
    const toolkitLauncher = toolkitShadow?.querySelector(".launcher");

    if (toolkitPanel) {
      toolkitPanel.style.zIndex = "2147483646";
    }

    if (toolkitLauncher) {
      toolkitLauncher.style.zIndex = "2147483646";
    }
  }

  function createPanel() {
    const style = document.createElement("style");
    style.textContent = `
      #wat-panel {
        position: fixed;
        right: 18px;
        top: 76px;
        z-index: 2147483647;

        display: flex;
        flex-direction: column;

        width: min(360px, calc(100vw - 36px));
        max-height: calc(100vh - 94px);
        overflow: hidden;

        color: #222;
        background: #fff;

        border: 1px solid #bbb;
        border-radius: 10px;

        box-shadow: 0 6px 24px rgba(0,0,0,.30);

        font-family: Arial, sans-serif;
        font-size: 11px;
        line-height: 1.4;
      }

      #wat-panel,
      #wat-panel * {
        box-sizing: border-box;
      }

      #wat-title {
        flex: 0 0 auto;

        display: flex;
        flex-direction: column;
        gap: 5px;

        padding: 10px 12px;

        background: #f8f9fa;
        border-bottom: 1px solid #ddd;

        cursor: grab;
        user-select: none;
        touch-action: none;
      }

      #wat-title-row {
        display: flex;
        align-items: center;
        min-width: 0;
      }

      #wat-heading {
        flex: 1;
        min-width: 0;

        color: #222;
        font-size: 14px;
        font-weight: bold;
        white-space: nowrap;
      }

      #wat-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      #wat-connection {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;

        color: #777;
        font-size: 9px;
        font-weight: 400;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #wat-connection::before {
        content: '';
        flex: 0 0 auto;

        width: 7px;
        height: 7px;

        border-radius: 50%;
        background: #999;
      }

      #wat-connection.online::before {
        background: #198754;
        box-shadow: 0 0 0 3px rgba(25,135,84,.12);
      }

      #wat-connection.offline::before {
        background: #dc3545;
        box-shadow: 0 0 0 3px rgba(220,53,69,.10);
      }

      #wat-panel.wat-dragging #wat-title {
        cursor: grabbing;
      }

      #wat-clear,
      #wat-toggle,
      #wat-logs-toggle,
      #wat-reset-position {
        height: 26px;

        border: 1px solid #bbb;
        border-radius: 6px;

        background: #fff;
        color: #444;

        cursor: pointer;

        font-family: Arial, sans-serif;
        font-size: 10px;
        line-height: 1;
      }

      #wat-clear,
      #wat-toggle,
      #wat-reset-position {
        width: 26px;
        padding: 0;
        font-size: 14px;
      }

      #wat-logs-toggle {
        padding: 0 7px;
        font-weight: bold;
      }

      #wat-clear:hover,
      #wat-toggle:hover,
      #wat-logs-toggle:hover,
      #wat-reset-position:hover {
        background: #f1f3f5;
        border-color: #aaa;
        color: #222;
      }

      #wat-list {
        overflow-y: auto;
        min-height: 0;
        flex: 1 1 auto;
        background: #fff;
      }

      #wat-panel.wat-collapsed #wat-list,
      #wat-panel.wat-collapsed #wat-diagnostics,
      #wat-panel.wat-collapsed #wat-connection,
      #wat-panel.wat-collapsed #wat-manual {
        display: none;
      }

      #wat-panel.wat-collapsed #wat-title {
        border-bottom: 0;
      }

      #wat-list:empty::after {
        content: 'Aguardando novos áudios…';
        display: block;

        margin: 10px;
        padding: 10px;

        color: #666;
        background: #f5f5f5;

        border: 1px solid #ddd;
        border-radius: 7px;

        text-align: center;
        font-size: 10px;
      }

      .wat-item {
        margin: 8px 10px;
        padding: 9px;

        background: #fff;

        border: 1px solid #d5d5d5;
        border-radius: 8px;
      }

      .wat-contact {
        margin-bottom: 4px;

        color: #222;
        font-size: 12px;
        font-weight: bold;
      }

      .wat-status {
        color: #198754;
        font-size: 10px;
        font-weight: bold;
      }

      .wat-text {
        margin-top: 7px;
        padding: 7px;

        background: #f5f5f5;

        border: 1px solid #ddd;
        border-radius: 6px;

        color: #333;
        font-size: 11px;

        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .wat-text:empty {
        display: none;
      }

      .wat-meta {
        margin-top: 5px;

        color: #777;
        font-size: 9px;
      }

      .wat-retry {
        width: 100%;

        margin-top: 8px;
        padding: 7px;

        border: 0;
        border-radius: 6px;

        background: #198754;
        color: #fff;

        cursor: pointer;

        font-size: 10px;
        font-weight: bold;
      }

      .wat-retry:hover {
        filter: brightness(.96);
      }

      #wat-diagnostics {
        display: none;
        flex: 0 0 auto;

        max-height: 210px;
        overflow-y: auto;

        padding: 8px 10px;

        border-top: 1px solid #ddd;

        background: #fafafa;
        color: #666;

        font: 10px/1.45 Consolas, monospace;
      }

      #wat-diagnostics.open {
        display: block;
      }

      .wat-log {
        margin-bottom: 5px;
        overflow-wrap: anywhere;
      }

      .wat-log.error {
        color: #dc3545;
      }

      #wat-manual {
        flex: 0 0 auto;

        margin: 10px;
        padding: 8px;

        background: #f5f5f5;

        border: 1px solid #ddd;
        border-radius: 7px;
      }

      #wat-history-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }

      #wat-history-controls {
        display: flex;
        flex-shrink: 0;
        gap: 3px;
      }

      #wat-history-body {
        height: var(--wat-search-height, 260px);
        max-height: max(80px, calc(100vh - 310px));
        overflow-y: auto;
        overflow-x: hidden;
        min-width: 0;

        margin-top: 7px;
        padding-top: 7px;

        border-top: 1px solid #ddd;
      }

      #wat-history-body[hidden] {
        display: none;
      }

      #wat-manual button {
        margin: 3px 3px 3px 0;
        padding: 7px 8px;

        border: 1px solid #bbb;
        border-radius: 6px;

        background: #fff;
        color: #444;

        cursor: pointer;

        font-family: Arial, sans-serif;
        font-size: 10px;
      }

      #wat-manual button:hover:not(:disabled) {
        background: #f1f3f5;
      }

      #wat-manual button:disabled {
        opacity: .5;
        cursor: default;
      }

      #wat-history-search {
        flex: 1;

        border: 0 !important;

        background: #495057 !important;
        color: #fff !important;

        font-weight: bold;
      }

      #wat-history-search:hover:not(:disabled) {
        background: #41484e !important;
      }

      #wat-history-submit {
        width: 100%;

        border: 0 !important;

        background: #0d6efd !important;
        color: #fff !important;

        font-weight: bold;
      }

      #wat-history-more {
        width: 100%;
      }

      #wat-history-status {
        margin-bottom: 6px;

        color: #666;
        font-size: 10px;

        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      #wat-history-list {
        min-height: 0;
        min-width: 0;
        width: 100%;
        max-width: 100%;
        overflow-x: hidden;
      }

      .wat-choice {
        display: flex;
        align-items: flex-start;
        gap: 7px;

        width: 100%;
        max-width: 100%;
        min-width: 0;

        padding: 7px;

        border-bottom: 1px solid #ddd;

        color: #444;
        font-size: 10px;
        overflow: hidden;
      }

      .wat-choice span {
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .wat-choice:last-child {
        border-bottom: 0;
      }

      .wat-choice:hover {
        background: #fafafa;
      }

      .wat-choice input {
        flex: 0 0 auto;
        margin-top: 2px;
      }
`;
    document.head.appendChild(style);

    const panel = document.createElement("section");
    panel.id = "wat-panel";
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
          <button id="wat-history-search" type="button">Buscar áudios da conversa</button>
          <div id="wat-history-controls">
            <button id="wat-history-smaller" type="button" aria-label="Reduzir altura da busca" title="Reduzir altura da busca">−</button>
            <button id="wat-history-larger" type="button" aria-label="Aumentar altura da busca" title="Aumentar altura da busca">+</button>
            <button id="wat-history-toggle" type="button" aria-controls="wat-history-body" aria-expanded="false">Expandir</button>
          </div>
        </div>
        <div id="wat-history-body" hidden>
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

    // Qualquer clique/toque no Transcriber traz o painel para frente.
    panel.addEventListener("pointerdown", bringTranscriberToFront, true);

    setupPanelDragging(panel);
    const historyBody = panel.querySelector("#wat-history-body");
    const historyToggle = panel.querySelector("#wat-history-toggle");
    const smaller = panel.querySelector("#wat-history-smaller");
    const larger = panel.querySelector("#wat-history-larger");
    let searchHeight = 260;
    const updateSearchSize = () => {
      historyBody.style.setProperty("--wat-search-height", `${searchHeight}px`);
      historyToggle.textContent = historyBody.hidden ? "Expandir" : "Recolher";
      historyToggle.setAttribute("aria-expanded", String(!historyBody.hidden));
      smaller.disabled = historyBody.hidden || searchHeight <= 140;
      larger.disabled = !historyBody.hidden && searchHeight >= 620;
    };
    historyToggle.addEventListener("click", () => {
      historyBody.hidden = !historyBody.hidden;
      updateSearchSize();
    });
    smaller.addEventListener("click", () => {
      searchHeight = Math.max(140, searchHeight - 60);
      updateSearchSize();
    });
    larger.addEventListener("click", () => {
      historyBody.hidden = false;
      searchHeight = Math.min(620, searchHeight + 60);
      updateSearchSize();
    });
    updateSearchSize();
    panel.querySelector("#wat-history-search").addEventListener("click", () => {
      historyBody.hidden = false;
      updateSearchSize();
      searchHistory(false);
    });
    panel.querySelector("#wat-history-more").addEventListener("click", () => searchHistory(true));
    panel.querySelector("#wat-history-list").addEventListener("change", updateHistorySelection);
    panel.querySelector("#wat-history-submit").addEventListener("click", () => {
      let count = 0;
      for (const { message, checkbox } of historyAudios.values()) {
        if (checkbox.checked && !checkbox.disabled && enqueueAudio(message, true)) count++;
      }
      updateHistorySelection();
      document.querySelector("#wat-history-status").textContent = `${count} áudio(s) enviado(s) para a fila.`;
      void processQueue();
    });
    panel.querySelector("#wat-clear").addEventListener("click", () => {
      panel.querySelector("#wat-list").replaceChildren();
      log("", "Painel limpo");
    });
    const toggle = panel.querySelector("#wat-toggle");
    panel.querySelector("#wat-logs-toggle").addEventListener("click", () => {
      panel.querySelector("#wat-diagnostics").classList.toggle("open");
    });
    toggle.addEventListener("click", () => {
      const collapsed = panel.classList.toggle("wat-collapsed");
      toggle.textContent = collapsed ? "+" : "−";
      toggle.title = collapsed ? "Expandir painel" : "Minimizar painel";
      toggle.setAttribute("aria-expanded", String(!collapsed));
    });
    return panel.querySelector("#wat-list");
  }

  function setupPanelDragging(panel) {
    const handle = panel.querySelector("#wat-title");
    let drag = null;
    let moved = false;

    function setPosition(left, top) {
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(0, document.documentElement.clientWidth - rect.width);
      const maxTop = Math.max(0, document.documentElement.clientHeight - rect.height);
      panel.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
      panel.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
      panel.style.right = "auto";
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
      panel.classList.remove("wat-dragging");
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    }

    handle.addEventListener("pointerdown", (event) => {
      if (drag || !event.isPrimary || event.button !== 0 || event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add("wat-dragging");
      event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      moved = true;
      setPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    });
    handle.addEventListener("pointerup", stopDragging);
    handle.addEventListener("pointercancel", stopDragging);
    handle.addEventListener("lostpointercapture", stopDragging);
    window.addEventListener("blur", () => stopDragging());
    window.addEventListener("resize", keepInView);
    new ResizeObserver(keepInView).observe(panel);

    panel.querySelector("#wat-reset-position").addEventListener("click", () => {
      stopDragging();
      moved = false;
      panel.style.removeProperty("left");
      panel.style.removeProperty("top");
      panel.style.removeProperty("right");
    });
  }

  const list = createPanel();
  log("", "Interface iniciada; aguardando a ponte WA-JS");

  function updateHistorySelection() {
    let count = 0;
    for (const { message, checkbox } of historyAudios.values()) {
      const item = queueItems.get(message.fullId);
      checkbox.disabled = !!item && !item.canRetry;
      if (checkbox.disabled) checkbox.checked = false;
      if (checkbox.checked) count++;
    }
    const button = document.querySelector("#wat-history-submit");
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
      setItemState(item, "🎤 Áudio recebido · Na fila");
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
      document.querySelector("#wat-history-list").replaceChildren();
      document.querySelector("#wat-history-more").hidden = true;
      updateHistorySelection();
    }
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => finishHistory({ requestId, error: "A busca demorou demais. Verifique se os dois scripts estão atualizados e se o WhatsApp terminou de carregar." }), 30000);
    historyRequest = { requestId, timeout };
    document.querySelector("#wat-history-search").disabled = true;
    document.querySelector("#wat-history-more").disabled = true;
    document.querySelector("#wat-history-status").textContent = "Buscando áudios recebidos…";
    window.postMessage({ source: "wat-ui", action: "history", requestId, chatId: older ? historyPage.chatId : undefined, before: older ? historyPage.before : undefined }, "*");
  }

  function finishHistory(result) {
    if (result.requestId !== historyRequest?.requestId) return;
    clearTimeout(historyRequest.timeout);
    historyRequest = null;
    document.querySelector("#wat-history-search").disabled = false;
    document.querySelector("#wat-history-more").disabled = false;
    const status = document.querySelector("#wat-history-status");
    if (result.error) {
      status.textContent = result.error;
      return;
    }
    historyPage = result;
    for (const message of result.audios) {
      if (historyAudios.has(message.fullId)) continue;
      const label = document.createElement("label");
      label.className = "wat-choice";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const text = document.createElement("span");
      const date = message.timestamp ? new Date(message.timestamp * 1000).toLocaleString("pt-BR") : "Data indisponível";
      text.textContent = `${message.contactName} · ${date} · ${formatDuration(message.duration)}`;
      label.append(checkbox, text);
      document.querySelector("#wat-history-list").append(label);
      historyAudios.set(message.fullId, { message, checkbox });
    }
    status.textContent = `${result.chatName}: ${historyAudios.size} áudio(s) encontrado(s).\n` + (result.hasMore ? "Busca em lotes de 100 mensagens. Use Buscar mais antigos para continuar." : "Fim do histórico disponível.") + "\nÁudios já na fila ou concluídos nesta sessão ficam desabilitados.";
    document.querySelector("#wat-history-more").hidden = !result.hasMore;
    updateHistorySelection();
  }

  function formatDuration(seconds) {
    const value = Number(seconds) || 0;
    return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
  }

  function createQueueItem(message, fullId) {
    const element = document.createElement("article");
    element.className = "wat-item";
    element.innerHTML = `
      <div class="wat-contact"></div>
      <div class="wat-status">🎤 Áudio recebido · Na fila</div>
      <div class="wat-text"></div>
      <div class="wat-meta">Áudio: ${formatDuration(message.duration)}</div>
    `;
    element.querySelector(".wat-contact").textContent = message.contactName || "Contato desconhecido";
    list.append(element);
    list.scrollTop = list.scrollHeight;
    return { message, fullId, element };
  }

  function setItemState(item, status, text = "", canRetry = false) {
    item.canRetry = canRetry;
    updateHistorySelection();
    const statusElement = item.element.querySelector(".wat-status");
    const textElement = item.element.querySelector(".wat-text");
    if (!statusElement || !textElement) return;
    statusElement.textContent = status;
    textElement.textContent = text;
    item.element.querySelector(".wat-retry")?.remove();

    if (canRetry) {
      const button = document.createElement("button");
      button.className = "wat-retry";
      button.type = "button";
      button.textContent = "Tentar novamente";
      button.addEventListener(
        "click",
        () => {
          button.remove();
          setItemState(item, "🎤 Áudio recebido · Na fila");
          transcriptionQueue.push(item);
          void processQueue();
        },
        { once: true },
      );
      item.element.appendChild(button);
    }
  }

  function gmRequest(options) {
    return new Promise((resolve, reject) =>
      GM_xmlhttpRequest({
        ...options,
        responseType: "json",
        onload: resolve,
        ontimeout: () => reject(new TypeError("Tempo limite ao acessar o backend local")),
        onerror: () => reject(new TypeError("Não foi possível acessar o backend local")),
      }),
    );
  }

  async function refreshDiagnostics() {
    const indicator = document.querySelector("#wat-connection");
    const diagnostics = document.querySelector("#wat-diagnostics");
    try {
      const response = await gmRequest({ method: "GET", url: `${DIAGNOSTICS_URL}?after=${lastEventId}`, timeout: 3000 });
      const result = typeof response.response === "string" ? JSON.parse(response.response) : response.response;
      if (response.status !== 200 || !result?.success) throw new Error("Resposta de diagnóstico inválida");
      if (lastServerUptime && result.status.uptimeSeconds < lastServerUptime) lastEventId = 0;
      lastServerUptime = result.status.uptimeSeconds;
      const worker = result.status.worker;
      const workerLabel = worker.status === "loading" ? " · modelo carregando" : worker.status === "ready" ? ` · ${worker.model} pronto` : worker.status === "error" ? " · worker com erro" : "";
      indicator.textContent = `Backend conectado${workerLabel}`;
      indicator.className = "online";
      for (const event of result.events || []) {
        lastEventId = Math.max(lastEventId, event.id);
        const line = document.createElement("div");
        line.className = `wat-log ${event.level}`;
        const time = new Date(event.timestamp).toLocaleTimeString("pt-BR");
        line.textContent = `${time} [${event.scope}] ${event.message}${event.details ? ` — ${event.details}` : ""}`;
        diagnostics.append(line);
      }
      while (diagnostics.children.length > 100) diagnostics.firstElementChild.remove();
      diagnostics.scrollTop = diagnostics.scrollHeight;
    } catch (error) {
      indicator.textContent = "Backend desconectado";
      indicator.className = "offline";
    }
  }

  void refreshDiagnostics();
  setInterval(refreshDiagnostics, 5000);

  async function sendToBackend(blob) {
    const formData = new FormData();
    formData.append("audio", blob, `audio-${Date.now()}.ogg`);
    log("API", "Enviando áudio ao backend");

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: API_URL,
        data: formData,
        responseType: "json",
        timeout: 10 * 60 * 1000,
        onload: (response) => {
          let result = response.response;
          if (typeof result === "string") {
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
        ontimeout: () => reject(new TypeError("Tempo limite ao acessar o backend local")),
        onerror: () => reject(new TypeError("Não foi possível acessar o backend local")),
      });
    });
  }

  async function processItem(item) {
    setItemState(item, "⬇ Baixando áudio do WhatsApp...");
    log("WA", "Baixando mídia", item.fullId);
    const blob = await requestMediaDownload(item.fullId);
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error("Mídia vazia ou indisponível");
    setItemState(item, "⬆ Enviando ao backend...");
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
    setItemState(item, "📝 Transcrição", text);
    log("QUEUE", "Transcrição concluída", item.fullId);
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
          const status = offline ? "⚠ Serviço de transcrição offline" : "⚠ Não foi possível transcrever";
          setItemState(item, status, offline ? "" : error.message, true);
          log("QUEUE", "Falha no processamento", item.fullId, error.message);
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
        reject(new Error("Tempo limite ao baixar o áudio do WhatsApp"));
      }, 30000);
      pendingDownloads.set(requestId, { resolve, reject, timeout });
      window.postMessage({ source: "wat-ui", action: "download", requestId, fullId }, "*");
    });
  }

  window.addEventListener("message", (event) => {
    if (event.data?.source !== "wat-wa-bridge") return;

    if (event.data.action === "ready") {
      log("WA", `Bridge pronto (${event.data.version ?? "versão desconhecida"})`);
      return;
    }

    if (event.data.action === "new-audio") {
      enqueueAudio(event.data);
      void processQueue();
      return;
    }

    if (event.data.action === "history-result") {
      finishHistory(event.data);
      return;
    }

    if (event.data.action === "download-result") {
      const pending = pendingDownloads.get(event.data.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingDownloads.delete(event.data.requestId);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.blob);
    }
  });

  window.postMessage({ source: "wat-ui", action: "status" }, "*");
})();
