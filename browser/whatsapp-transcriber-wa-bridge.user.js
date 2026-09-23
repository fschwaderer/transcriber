// ==UserScript==
// @name         WhatsApp Audio Transcriber - WA Bridge
// @namespace    whatsapp-audio-transcriber
// @version      0.3.0
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
    return message.id?._serialized ?? message.id?.$1 ??
      (message.id?.remote && message.id?.id
        ? `${message.id.fromMe}_${message.id.remote}_${message.id.id}` : null);
  }

  async function audioDetails(message) {
    const fullId = messageId(message);
    if (!fullId || !['ptt', 'audio'].includes(message.type) ||
        message.id?.fromMe === true || fullId.startsWith('true_')) return null;
    const remote = message.id?.remote?._serialized ?? String(message.id?.remote ?? fullId.split('_')[1] ?? '');
    const contactId = message.author?._serialized ?? String(message.author || remote);
    let contactName = contactId.split('@')[0] || 'Contato desconhecido';
    try {
      const contact = await WPP.contact.get(contactId);
      contactName = [contact?.name, contact?.pushname, contact?.formattedName,
        contact?.shortName, contact?.notifyName].find(value => typeof value === 'string' && value.trim()) || contactName;
    } catch (error) {
      console.warn('[TRANSCRIBER:WA]', 'Nome do contato indisponível:', error?.message);
    }
    return { fullId, contactName, type: message.type, duration: message.duration,
      timestamp: Number(message.t ?? message.timestamp) || 0 };
  }

  function announceReady() {
    window.postMessage({
      source: 'wat-wa-bridge',
      action: 'ready',
      version: WPP.version
    }, '*');
  }

  window.addEventListener('message', async (event) => {
    if (event.data?.source !== 'wat-ui') return;

    if (event.data.action === 'history') {
      const response = { source: 'wat-wa-bridge', action: 'history-result', requestId: event.data.requestId };
      try {
        if (!ready) throw new Error('WhatsApp ainda está carregando. Aguarde e tente novamente.');
        const chat = WPP.chat.getActiveChat();
        if (!chat) throw new Error('Abra uma conversa no WhatsApp para buscar seus áudios.');
        const chatId = chat.id?._serialized ?? String(chat.id);
        if (event.data.chatId && event.data.chatId !== chatId) {
          throw new Error('A conversa aberta mudou. Clique em Buscar áudios da conversa para iniciar outra busca.');
        }
        const options = { count: 100, direction: 'before' };
        if (event.data.before) options.id = event.data.before;
        const messages = await WPP.chat.getMessages(chatId, options);
        messages.sort((a, b) => Number(a.t ?? a.timestamp ?? 0) - Number(b.t ?? b.timestamp ?? 0));
        const before = messages.length ? messageId(messages[0]) : null;
        const audios = (await Promise.all(messages.map(audioDetails))).filter(Boolean);
        window.postMessage({ ...response, chatId, chatName: chat.name || chat.formattedTitle || chatId,
          audios, before, hasMore: !!before && before !== event.data.before,
          scanned: messages.length }, '*');
      } catch (error) {
        window.postMessage({ ...response, error: error?.message || 'Não foi possível buscar os áudios.' }, '*');
      }
      return;
    }

    if (event.data.action === 'status' && ready) {
      console.log('[TRANSCRIBER:WA]', 'Solicitação de status recebida da interface');
      announceReady();
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
