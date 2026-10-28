import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const bridge = readFileSync(new URL('../../browser/whatsapp-transcriber-wa-bridge.user.js', import.meta.url), 'utf8');

function setup({ chatId = '123@c.us', messages, contact = async () => ({ name: 'Cliente' }) }) {
  const sent = [];
  const timers = new Map();
  let handler, sequence = 0;
  const window = { addEventListener(_type, callback) { handler = callback; }, postMessage(data) { sent.push(data); } };
  vm.runInNewContext(bridge, {
    window, console,
    setTimeout(callback) { timers.set(++sequence, callback); return sequence; },
    clearTimeout(id) { timers.delete(id); },
    WPP: {
      version: 'test', loader: { onReady(fn) { fn(); } }, on() {},
      contact: { get: contact },
      chat: { getActiveChat: () => ({ id: chatId, name: 'Cliente' }), getMessages: async () => messages },
    },
  });
  return { sent, timers, request: action => handler({ source: window, data: { source: 'wat-ui', action, requestId: action } }) };
}

for (const action of ['history', 'conversation-history']) {
  test(`${action}: aceita IDs com toString e ignora propriedades minificadas que nao sao strings`, async () => {
    const fixture = setup({
      chatId: { toString: () => '123@c.us' },
      messages: [{ id: { $1: { user: '123' }, remote: { toString: () => '123@c.us' }, id: 'audio', fromMe: false }, type: 'ptt', t: 100 }],
    });
    await fixture.request(action);
    const result = fixture.sent.find(message => message.action === `${action}-result`);
    assert.equal(result.error, undefined);
    assert.equal(result.chatId, '123@c.us');
    const records = result.audios ?? result.messages;
    assert.equal(records[0].fullId, 'false_123@c.us_audio');
  });

  test(`${action}: consulta de contato travada nao impede resposta do historico`, async () => {
    const fixture = setup({ messages: [{ id: 'false_123@c.us_audio', type: 'ptt', t: 100 }], contact: () => new Promise(() => {}) });
    const pending = fixture.request(action);
    // Libera microtarefas ate a consulta de contato ser iniciada.
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(fixture.timers.size, 'Consultas devem ter prazo limite');
    for (const callback of [...fixture.timers.values()]) callback();
    await pending;
    const result = fixture.sent.find(message => message.action === `${action}-result`);
    assert.equal(result.error, undefined);
    assert.equal((result.audios ?? result.messages)[0].contactName, '123');
  });
}
