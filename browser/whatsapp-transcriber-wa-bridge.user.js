// ==UserScript==
// @name         WhatsApp Audio Transcriber - WA Bridge
// @namespace    whatsapp-audio-transcriber
// @version      0.2.3
// @description  Ponte WA-JS para o WhatsApp Audio Transcriber.
// @match        https://web.whatsapp.com/*
// @require      https://github.com/wppconnect-team/wa-js/releases/download/nightly/wppconnect-wa.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  let ready = false;

  function announceReady() {
    window.postMessage({
      source: 'wat-wa-bridge',
      action: 'ready',
      version: WPP.version
    }, '*');
  }

  window.addEventListener('message', async (event) => {
    if (event.data?.source !== 'wat-ui') return;

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

      if (!['ptt', 'audio'].includes(message.type) || message.id?.fromMe === true) return;

      const remote = message.id?.remote?._serialized ?? String(message.id?.remote ?? '');
      const fullId = message.id?.$1 ??
        (remote && message.id?.id ? `${message.id.fromMe}_${remote}_${message.id.id}` : null);
      if (!fullId) return;

      const author = message.author?._serialized ?? String(message.author ?? '');
      const contactId = author || remote;
      let contactName = '';
      try {
        const contact = await WPP.contact.get(contactId);
        const candidates = [
          contact?.name,
          contact?.pushname,
          contact?.formattedName,
          contact?.shortName,
          contact?.notifyName
        ];
        contactName = candidates.find((value) => typeof value === 'string' && value.trim()) || '';
      } catch (error) {
        console.warn('[TRANSCRIBER:WA]', 'Nome do contato indisponível:', error?.message);
      }
      contactName ||= contactId.split('@')[0] || 'Contato desconhecido';

      console.log('[TRANSCRIBER:WA]', 'Áudio detectado', fullId);
      window.postMessage({
        source: 'wat-wa-bridge',
        action: 'new-audio',
        fullId,
        duration: message.duration,
        type: message.type,
        contactName
      }, '*');
    });
  });
})();
