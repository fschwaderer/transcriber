// ==UserScript==
// @name         WhatsApp Audio Transcriber - WA Bridge
// @namespace    whatsapp-audio-transcriber
// @version      0.4.1
// @description  Ponte WA-JS para o WhatsApp Audio Transcriber.
// @match        https://web.whatsapp.com/*
// @require      https://github.com/wppconnect-team/wa-js/releases/download/nightly/wppconnect-wa.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  let ready = false;

  function messageId(message) {
    if (typeof message.id === 'string') return message.id;
    for (const candidate of [message.id?._serialized, message.id?.$1, serializedId(message.id)]) {
      if (typeof candidate === 'string' && /^(true|false)_/.test(candidate)) return candidate;
    }
    const remote = serializedId(message.id?.remote);
    return remote && typeof message.id?.id === 'string'
      ? `${message.id.fromMe === true}_${remote}_${message.id.id}` : null;
  }

  function withTimeout(operation, milliseconds, description) {
    let timeout;
    return Promise.race([
      Promise.resolve().then(operation),
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(description)), milliseconds);
      }),
    ]).finally(() => clearTimeout(timeout));
  }

  function resolveContactName(contactId, fallback, names) {
    if (!names.has(contactId)) {
      names.set(contactId, withTimeout(() => WPP.contact.get(contactId), 1500,
        'Consulta de nome do contato demorou demais.').then(contact =>
        [contact?.name, contact?.pushname, contact?.formattedName, contact?.shortName, contact?.notifyName, fallback]
          .find(value => typeof value === 'string' && value.trim())
      ).catch(() => fallback));
    }
    return names.get(contactId);
  }

  async function audioDetails(message, names = new Map()) {
    const fullId = messageId(message);
    if (!fullId || !['ptt', 'audio'].includes(message.type) ||
        message.id?.fromMe === true || message.fromMe === true || fullId.startsWith('true_')) return null;
    const remote = serializedId(message.id?.remote) || fullId.split('_')[1] || '';
    const contactId = serializedId(message.author) || remote;
    const contactName = await resolveContactName(contactId, contactId.split('@')[0] || 'Contato desconhecido', names);
    return { fullId, contactName, type: message.type, duration: message.duration,
      timestamp: Number(message.t ?? message.timestamp) || 0 };
  }

  function announceReady() {
    window.postMessage({
      source: 'wat-wa-bridge',
      action: 'ready',
      bridgeVersion: '0.4.1',
      version: WPP.version
    }, '*');
  }

  function serializedId(value) {
    if (typeof value === 'string') return value;
    if (typeof value?._serialized === 'string') return value._serialized;
    const text = value?.toString?.();
    return typeof text === 'string' && text !== '[object Object]' ? text : '';
  }

  async function conversationDetails(message, chatId, names) {
    const fullId = messageId(message);
    if (!fullId) return null;
    const fromMe = message.id?.fromMe === true || message.fromMe === true || fullId.startsWith('true_');
    const senderId = serializedId(message.author) || serializedId(message.from) ||
      (!chatId.endsWith('@g.us') ? chatId : '');
    let contactName = 'Você';
    if (!fromMe) {
      const fallback = message.notifyName || senderId.split('@')[0] || 'Remetente desconhecido';
      contactName = await resolveContactName(senderId, fallback, names);
    }
    // body de midia pode conter dados internos; apenas chat usa o corpo textual.
    const text = message.type === 'chat' ? (message.body ?? message.text ?? '') : (message.caption ?? '');
    return { fullId, contactName, fromMe, type: message.type || 'unknown',
      text: typeof text === 'string' ? text : '', duration: Number(message.duration) || 0,
      timestamp: Number(message.t ?? message.timestamp) || 0 };
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data?.source !== 'wat-ui') return;

    if (event.data.action === 'status') {
      window.postMessage({ source: 'wat-wa-bridge', action: 'bridge-status', ready, bridgeVersion: '0.4.1' }, '*');
      if (ready) announceReady();
      return;
    }

    if (event.data.action === 'conversation-history') {
      const response = { source: 'wat-wa-bridge', action: 'conversation-history-result', requestId: event.data.requestId };
      try {
        if (!ready) throw new Error('WhatsApp ainda está carregando. Aguarde e tente novamente.');
        const chat = WPP.chat.getActiveChat();
        if (!chat) throw new Error('Abra a conversa que deseja exportar.');
        const chatId = serializedId(chat.id);
        if (!chatId) throw new Error('Não foi possível identificar a conversa aberta. Recarregue o WhatsApp e atualize a ponte WA Bridge.');
        if (event.data.chatId && event.data.chatId !== chatId) {
          throw new Error('A conversa aberta mudou. Volte à conversa anterior ou clique em Nova conversa.');
        }
        const options = { count: 100, direction: 'before' };
        if (event.data.before) options.id = event.data.before;
        const messages = await withTimeout(() => WPP.chat.getMessages(chatId, options), 20000,
          'O WhatsApp não respondeu à busca de mensagens. Recarregue a página e tente novamente.');
        // A ordem retornada pelo WhatsApp determina o cursor, inclusive quando
        // varias mensagens compartilham o mesmo segundo.
        messages.sort((a, b) => Number(a.t ?? a.timestamp ?? 0) - Number(b.t ?? b.timestamp ?? 0));
        const before = messages.length ? messageId(messages[0]) : null;
        const names = new Map();
        const records = (await Promise.all(messages.map(message => conversationDetails(message, chatId, names)))).filter(Boolean);
        window.postMessage({ ...response, chatId, chatName: chat.name || chat.formattedTitle || chatId,
          messages: records, before, hasMore: !!before && before !== event.data.before }, '*');
      } catch (error) {
        window.postMessage({ ...response, error: error?.message || 'Não foi possível carregar a conversa.' }, '*');
      }
      return;
    }

    if (event.data.action === 'history') {
      const response = { source: 'wat-wa-bridge', action: 'history-result', requestId: event.data.requestId };
      try {
        if (!ready) throw new Error('WhatsApp ainda está carregando. Aguarde e tente novamente.');
        const chat = WPP.chat.getActiveChat();
        if (!chat) throw new Error('Abra uma conversa no WhatsApp para buscar seus áudios.');
        const chatId = serializedId(chat.id);
        if (!chatId) throw new Error('Não foi possível identificar a conversa aberta. Recarregue o WhatsApp e atualize a ponte WA Bridge.');
        if (event.data.chatId && event.data.chatId !== chatId) {
          throw new Error('A conversa aberta mudou. Clique em Buscar áudios da conversa para iniciar outra busca.');
        }
        const options = { count: 100, direction: 'before' };
        if (event.data.before) options.id = event.data.before;
        const messages = await withTimeout(() => WPP.chat.getMessages(chatId, options), 20000,
          'O WhatsApp não respondeu à busca de áudios. Recarregue a página e tente novamente.');
        messages.sort((a, b) => Number(a.t ?? a.timestamp ?? 0) - Number(b.t ?? b.timestamp ?? 0));
        const before = messages.length ? messageId(messages[0]) : null;
        const names = new Map();
        const audios = (await Promise.all(messages.map(message => audioDetails(message, names)))).filter(Boolean);
        window.postMessage({ ...response, chatId, chatName: chat.name || chat.formattedTitle || chatId,
          audios, before, hasMore: !!before && before !== event.data.before,
          scanned: messages.length }, '*');
      } catch (error) {
        window.postMessage({ ...response, error: error?.message || 'Não foi possível buscar os áudios.' }, '*');
      }
      return;
    }

    if (event.data.action !== 'download' || !ready) return;

    try {
      const blob = await WPP.chat.downloadMedia(event.data.fullId);
      window.postMessage({
        source: 'wat-wa-bridge',
        action: 'download-result',
        requestId: event.data.requestId,
        blob
      }, '*');
    } catch (error) {
      window.postMessage({
        source: 'wat-wa-bridge',
        action: 'download-result',
        requestId: event.data.requestId,
        error: error?.message || 'Não foi possível baixar o áudio'
      }, '*');
    }
  });

  WPP.loader.onReady(() => {
    ready = true;
    console.log('[TRANSCRIBER:WA]', `Bridge WA-JS pronto (${WPP.version})`);
    announceReady();

    WPP.on('chat.new_message', async (message) => {
      console.log('[TRANSCRIBER:WA]', 'Nova mensagem observada', {
        type: message.type,
        fromMe: message.id?.fromMe
      });

      const details = await audioDetails(message);
      if (!details) return;
      console.log('[TRANSCRIBER:WA]', '?udio detectado', details.fullId);
      window.postMessage({ source: 'wat-wa-bridge', action: 'new-audio', ...details }, '*');
    });
  });
})();
