// ==UserScript==
// @name         WhatsApp Audio Transcriber
// @namespace    whatsapp-audio-transcriber
// @version      0.5.3
// @description  Envia áudios recebidos no WhatsApp Web para transcrição local.
// @match        https://web.whatsapp.com/*
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// @sandbox      DOM
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
  const conversationMessages = new Map();
  let conversationPage = null;
  let conversationLoading = false;
  let conversationStop = false;
  let conversationRequest = null;
  const conversationCursors = new Set();
  let lastEventId = 0;
  let lastServerUptime = 0;

  const log = (scope, ...args) => {
    if (DEBUG) console.log(`[TRANSCRIBER${scope ? `:${scope}` : ""}]`, ...args);
  };

  function sendBridgeRequest(data) {
    document.dispatchEvent(new CustomEvent("wat-ui-request", { detail: JSON.stringify(data) }));
    // Mantem compatibilidade com pontes anteriores; a ponte nova deduplica pelo ID.
    window.postMessage(data, "*");
  }

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

      #wat-export { margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd; }
      #wat-export summary { cursor: pointer; font-size: 11px; font-weight: bold; }
      #wat-export-status, #wat-export-hint { font-size: 10px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 5px 0; }

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
        <span id="wat-wa-status" role="status" aria-live="polite">WhatsApp: verificando ponte…</span>
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
        <details id="wat-export">
          <summary>Exportar conversa (textos e áudios)</summary>
          <button id="wat-export-load" type="button">Carregar mensagens</button>
          <button id="wat-export-max" type="button">Carregar máximo retroativo</button>
          <button id="wat-export-stop" type="button" disabled>Parar busca</button>
          <button id="wat-export-reset" type="button">Nova conversa</button>
          <div id="wat-export-status" role="status" aria-live="polite">Abra uma conversa. Você pode exportar mesmo sem áudios.</div>
          <button id="wat-export-txt" type="button">Exportar TXT</button>
          <button id="wat-export-html" type="button">Exportar com negrito (HTML)</button>
          <p id="wat-export-hint">Exportar carrega as últimas 100 mensagens se nenhuma foi carregada. Para um histórico longo, use Carregar máximo retroativo; você pode exportar o trecho já carregado durante a busca. Não é necessário ter áudios. TXT usa **Nome**. HTML exibe nomes em negrito. Inclui textos enviados e recebidos e transcrições já concluídas nesta aba. A busca depende do histórico disponível no WhatsApp.</p>
        </details>
      </div>
      <div id="wat-list"></div>
      <div id="wat-diagnostics" aria-live="polite"></div>
    `;
    document.body.appendChild(panel);

    // Qualquer clique/toque no Transcriber traz o painel para frente.
    panel.addEventListener("pointerdown", bringTranscriberToFront, true);

    panel.querySelector("#wat-export-load").addEventListener("click", () => void loadConversation(false));
    panel.querySelector("#wat-export-max").addEventListener("click", () => void loadConversation(true));
    panel.querySelector("#wat-export-stop").addEventListener("click", () => {
      conversationStop = true;
      document.querySelector("#wat-export-status").textContent = "Parando após o lote atual. As mensagens carregadas serão preservadas…";
    });
    panel.querySelector("#wat-export-reset").addEventListener("click", () => {
      if (conversationLoading) return;
      conversationMessages.clear();
      conversationCursors.clear();
      conversationPage = null;
      updateConversationControls();
      document.querySelector("#wat-export-status").textContent = "Abra uma conversa. Você pode exportar mesmo sem áudios.";
    });
    panel.querySelector("#wat-export-txt").addEventListener("click", () => void exportConversation(false));
    panel.querySelector("#wat-export-html").addEventListener("click", () => void exportConversation(true));
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
    // O arraste e um recurso opcional: uma falha nele nao pode impedir buscas.
    try {
      setupPanelDragging(panel);
    } catch (error) {
      log("UI", "Não foi possível configurar o arraste do painel.", error.message);
    }
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
    if (typeof ResizeObserver === "function") new ResizeObserver(keepInView).observe(panel);

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
  const bridgeStatusTimeout = setTimeout(() => {
    document.querySelector("#wat-wa-status").textContent =
      "WhatsApp: ponte sem resposta. Atualize e habilite o WA Bridge no Tampermonkey e recarregue a página.";
  }, 5000);

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
    const timeout = setTimeout(
      () =>
        finishHistory({
          requestId,
          error: historyRequest?.progress
            ? `A busca demorou demais. Última etapa: ${historyRequest.progress}`
            : "A ponte do WhatsApp não confirmou a busca. Atualize os dois scripts no Tampermonkey e recarregue a página.",
        }),
      30000,
    );
    const connectionTimeout = setTimeout(() => {
      if (historyRequest?.requestId === requestId && !historyRequest.progress) {
        finishHistory({ requestId, error: "A ponte não respondeu. Habilite o script WhatsApp Audio Transcriber - WA Bridge no Tampermonkey e recarregue a página." });
      }
    }, 5000);
    historyRequest = { requestId, timeout, connectionTimeout };
    document.querySelector("#wat-history-search").disabled = true;
    document.querySelector("#wat-history-more").disabled = true;
    document.querySelector("#wat-history-status").textContent = "Buscando áudios recebidos…";
    sendBridgeRequest(
      {
        source: "wat-ui",
        action: "history",
        requestId,
        chatId: older ? historyPage.chatId : undefined,
        before: older ? historyPage.before : undefined,
      },
    );
  }

  function finishHistory(result) {
    if (result.requestId !== historyRequest?.requestId) return;
    clearTimeout(historyRequest.timeout);
    clearTimeout(historyRequest.connectionTimeout);
    historyRequest = null;
    document.querySelector("#wat-history-search").disabled = false;
    document.querySelector("#wat-history-more").disabled = false;
    const status = document.querySelector("#wat-history-status");
    if (result.error) {
      status.textContent = result.error;
      return;
    }
    if (!Array.isArray(result.audios)) {
      status.textContent = "A ponte devolveu uma resposta inválida. Atualize os dois scripts no Tampermonkey.";
      return;
    }
    status.textContent = "Organizando os áudios encontrados…";
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
    status.textContent =
      `${result.chatName}: ${historyAudios.size} áudio(s) encontrado(s).\n` +
      (result.hasMore ? "Busca em lotes de 100 mensagens. Use Buscar mais antigos para continuar." : "Fim do histórico disponível.") +
      "\nÁudios já na fila ou concluídos nesta sessão ficam desabilitados.";
    document.querySelector("#wat-history-more").hidden = !result.hasMore;
    updateHistorySelection();
  }

  function updateConversationControls() {
    document.querySelector("#wat-export-load").disabled = conversationLoading || conversationPage?.hasMore === false;
    document.querySelector("#wat-export-load").textContent = conversationPage ? "Carregar mais antigas" : "Carregar mensagens";
    document.querySelector("#wat-export-max").disabled = conversationLoading || conversationPage?.hasMore === false;
    document.querySelector("#wat-export-stop").disabled = !conversationLoading || conversationStop;
    document.querySelector("#wat-export-reset").disabled = conversationLoading;
    for (const id of ["#wat-export-txt", "#wat-export-html"]) {
      document.querySelector(id).disabled = conversationLoading && conversationMessages.size === 0;
    }
  }

  function requestConversationPage() {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        const progress = conversationRequest?.progress;
        clearTimeout(conversationRequest?.connectionTimeout);
        conversationRequest = null;
        reject(new Error(progress
          ? `A busca demorou demais. Última etapa: ${progress}`
          : "A ponte do WhatsApp não confirmou a busca. Atualize os dois scripts no Tampermonkey e recarregue a página."));
      }, 60000);
      const connectionTimeout = setTimeout(() => {
        if (conversationRequest?.requestId !== requestId || conversationRequest.progress) return;
        clearTimeout(timeout);
        conversationRequest = null;
        reject(new Error("A ponte não respondeu. Habilite o script WhatsApp Audio Transcriber - WA Bridge no Tampermonkey e recarregue a página."));
      }, 5000);
      conversationRequest = { requestId, timeout, connectionTimeout, resolve, reject };
      sendBridgeRequest({ source: "wat-ui", action: "conversation-history", requestId,
        chatId: conversationPage?.chatId, before: conversationPage?.before });
    });
  }

  function acceptConversationPage(result) {
    if (result.requestId !== conversationRequest?.requestId) return;
    const pending = conversationRequest;
    clearTimeout(pending.timeout);
    clearTimeout(pending.connectionTimeout);
    conversationRequest = null;
    if (result.error) pending.reject(new Error(result.error));
    else if (!Array.isArray(result.messages)) pending.reject(new Error("A ponte devolveu uma resposta inválida. Atualize os dois scripts."));
    else pending.resolve(result);
  }

  async function loadConversation(maximum) {
    if (conversationLoading || conversationPage?.hasMore === false) return;
    conversationLoading = true;
    conversationStop = false;
    updateConversationControls();
    const status = document.querySelector("#wat-export-status");
    try {
      do {
        status.textContent = `Carregando mensagens antigas… ${conversationMessages.size} mensagem(ns) disponível(is). Você pode parar a busca.`;
        const result = await requestConversationPage();
        if (conversationPage && result.chatId !== conversationPage.chatId) throw new Error("A conversa mudou. Inicie uma nova busca.");
        const previousSize = conversationMessages.size;
        for (const message of result.messages) {
          if (!conversationMessages.has(message.fullId)) conversationMessages.set(message.fullId, message);
        }
        // Evita repeticoes infinitas se o WhatsApp devolver o mesmo lote/cursor.
        result.hasMore = result.hasMore && conversationMessages.size > previousSize && !conversationCursors.has(result.before);
        if (result.before) conversationCursors.add(result.before);
        conversationPage = result;
        updateConversationControls();
        status.textContent = `${result.chatName}: ${conversationMessages.size} mensagem(ns) carregada(s).`;
        if (!maximum || !result.hasMore || conversationStop) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      } while (!conversationStop);
      status.textContent += conversationStop ? "\nBusca interrompida. Você pode continuar ou exportar este trecho." :
        conversationPage.hasMore ? "\nVocê pode carregar mais antigas ou exportar este trecho." :
          "\nFim do histórico disponibilizado pelo WhatsApp. Isso pode ser apenas parte da conversa completa.";
    } catch (error) {
      status.textContent = `${error.message}\n${conversationMessages.size} mensagem(ns) preservada(s) para exportação.`;
    } finally {
      conversationLoading = false;
      updateConversationControls();
    }
  }

  function conversationText(message) {
    if (["ptt", "audio"].includes(message.type)) {
      const transcription = queueItems.get(message.fullId)?.transcription;
      return `[Áudio · ${formatDuration(message.duration)}] ${transcription || "[Sem transcrição nesta sessão]"}`;
    }
    if (message.type === "chat") return message.text || "[Texto indisponível]";
    const types = { image: "Imagem", video: "Vídeo", document: "Documento", sticker: "Figurinha",
      revoked: "Mensagem apagada", ciphertext: "Mensagem indisponível", location: "Localização", vcard: "Contato" };
    return `[${types[message.type] || "Mensagem sem texto"}]${message.text ? ` ${message.text}` : ""}`;
  }

  function conversationDate(timestamp) {
    return timestamp ? new Date(timestamp * 1000).toLocaleString("pt-BR", { hour12: false }) : "Data/hora indisponível";
  }

  function escapeExportHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function buildConversationExport(rich) {
    const messages = [...conversationMessages.values()].sort((a, b) => a.timestamp - b.timestamp);
    const title = `Conversa: ${conversationPage.chatName}`;
    const note = `Exportado em ${new Date().toLocaleString("pt-BR")} · ${messages.length} mensagem(ns).\n` +
      `Horários no fuso deste computador (${Intl.DateTimeFormat().resolvedOptions().timeZone}).\n` +
      "Trecho carregado do WhatsApp Web; pode não incluir todo o histórico. Áudios incluem somente transcrições concluídas nesta aba.";
    if (rich) {
      const blocks = messages.map(message => `<article><div>[${escapeExportHtml(conversationDate(message.timestamp))}] <strong>${escapeExportHtml(message.contactName)}</strong></div><p>${escapeExportHtml(conversationText(message))}</p></article>`).join("\n");
      return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escapeExportHtml(title)}</title><style>body{font:16px Arial,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#222}p{white-space:pre-wrap;overflow-wrap:anywhere}article{border-bottom:1px solid #ddd;padding:12px 0}</style><h1>${escapeExportHtml(title)}</h1><p>${escapeExportHtml(note)}</p>${blocks}</html>`;
    }
    return `${title}\n${note}\n\n` + messages.map(message => {
      const name = String(message.contactName || "Remetente desconhecido").replace(/[\r\n]/g, " ");
      return `[${conversationDate(message.timestamp)}] **${name}**\n${conversationText(message)}`;
    }).join("\n\n") + "\n";
  }

  async function exportConversation(rich) {
    if (!conversationMessages.size) {
      if (conversationLoading) return;
      await loadConversation(false);
    }
    if (!conversationPage || !conversationMessages.size) return;
    const content = buildConversationExport(rich);
    const blob = new Blob(["\uFEFF", content.replace(/\r?\n/g, "\r\n")], { type: rich ? "text/html;charset=utf-8" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const name = conversationPage.chatName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 100).replace(/[. ]+$/g, "") || "conversa";
    anchor.href = url;
    anchor.download = `WhatsApp-${name}-${new Date().toISOString().slice(0, 10)}.${rich ? "html" : "txt"}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
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
      const workerLabel =
        worker.status === "loading"
          ? " · modelo carregando"
          : worker.status === "ready"
            ? ` · ${worker.model} pronto`
            : worker.status === "error"
              ? " · worker com erro"
              : "";
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
    item.transcription = text;
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
      sendBridgeRequest({ source: "wat-ui", action: "download", requestId, fullId });
    });
  }

  function handleBridgeMessage(event) {
    if (event.data?.source !== "wat-wa-bridge") return;

    if (event.data.action === "request-progress") {
      const { requestId, message } = event.data;
      if (typeof message !== "string") return;
      if (requestId === historyRequest?.requestId) {
        clearTimeout(historyRequest.connectionTimeout);
        historyRequest.progress = message;
        document.querySelector("#wat-history-status").textContent = message;
      }
      if (requestId === conversationRequest?.requestId) {
        clearTimeout(conversationRequest.connectionTimeout);
        conversationRequest.progress = message;
        document.querySelector("#wat-export-status").textContent = `${message}\n${conversationMessages.size} mensagem(ns) já carregada(s).`;
      }
      return;
    }

    if (event.data.action === "bridge-status" || event.data.action === "ready") {
      clearTimeout(bridgeStatusTimeout);
      const ready = event.data.action === "ready" || event.data.ready;
      document.querySelector("#wat-wa-status").textContent = ready
        ? `WhatsApp: ponte pronta${event.data.bridgeVersion ? ` (${event.data.bridgeVersion})` : " · atualize o WA Bridge"}`
        : "WhatsApp: ponte ativa, aguardando o carregamento do WhatsApp…";
    }

    if (event.data.action === "conversation-history-result") {
      acceptConversationPage(event.data);
      return;
    }

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
      else if (typeof event.data.audioDataUrl === "string") {
        try {
          const match = /^data:([^,]*);base64,([A-Za-z0-9+/=]*)$/.exec(event.data.audioDataUrl);
          if (!match) throw new Error("O áudio recebido da ponte está inválido.");
          const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
          pending.resolve(new Blob([bytes], { type: match[1] || "audio/ogg" }));
        } catch (error) { pending.reject(error); }
      }
      else pending.resolve(event.data.blob);
    }
  }

  document.addEventListener("wat-wa-response", event => {
    if (typeof event.detail !== "string") return;
    let data;
    try { data = JSON.parse(event.detail); } catch { return; }
    handleBridgeMessage({ data });
  });
  window.addEventListener("message", event => {
    if (event.source !== window) return;
    handleBridgeMessage(event);
  });

  sendBridgeRequest({ source: "wat-ui", action: "status", requestId: crypto.randomUUID() });
})();
