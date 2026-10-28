import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ui = readFileSync(new URL('../../browser/whatsapp-transcriber.user.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../../browser/whatsapp-transcriber-wa-bridge.user.js', import.meta.url), 'utf8');

function exportContext() {
  const elements = new Map();
  const context = vm.createContext({
    document: { querySelector(id) { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); } },
    setTimeout: (callback) => { callback(); }, clearTimeout() {},
  });
  vm.runInContext(`
    const conversationMessages = new Map(), conversationCursors = new Set(), queueItems = new Map();
    let conversationPage = null, conversationLoading = false, conversationStop = false, conversationRequest = null;
    ${ui.slice(ui.indexOf('  function updateConversationControls()'), ui.indexOf('  function createQueueItem('))}
  `, context);
  return { context, elements, run: code => vm.runInContext(code, context) };
}

test('exporta em ordem cronologica com nomes, datas, multiline e transcricoes; HTML escapa conteudo', () => {
  const { run } = exportContext();
  run(`
    conversationPage = { chatName: 'Grupo <amigos>' };
    conversationMessages.set('b', { fullId:'b', timestamp:200, contactName:'Você', type:'ptt', duration:65 });
    conversationMessages.set('a', { fullId:'a', timestamp:100, contactName:'Ana <script>', type:'chat', text:'Olá\\nTudo bem? <img src=x onerror=alert(1)>' });
    queueItems.set('b', { transcription:'Bom dia!' });
  `);
  const txt = run('buildConversationExport(false)');
  assert.ok(txt.indexOf('**Ana <script>**') < txt.indexOf('**Você**'));
  assert.match(txt, /Olá\nTudo bem/);
  assert.match(txt, /Áudio · 1:05.*Bom dia!/);
  assert.match(txt, /\[\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}:\d{2}\] \*\*Ana/);
  const html = run('buildConversationExport(true)');
  assert.match(html, /<strong>Ana &lt;script&gt;<\/strong>/);
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img/);
});

test('busca maxima continua apos lotes sem audio e para quando o WhatsApp repete mensagens', async () => {
  const { run, elements } = exportContext();
  run(`
    const batches = [
      { chatId:'chat', chatName:'Ana', before:'b', hasMore:true, messages:[{fullId:'b',type:'chat',text:'recente',timestamp:200}] },
      { chatId:'chat', chatName:'Ana', before:'a', hasMore:true, messages:[{fullId:'a',type:'chat',text:'antiga',timestamp:100}] },
      { chatId:'chat', chatName:'Ana', before:'a', hasMore:true, messages:[{fullId:'a',type:'chat',text:'antiga',timestamp:100}] }
    ];
    requestConversationPage = async () => { if (!batches.length) throw Error('loop infinito'); return batches.shift(); };
  `);
  await run('loadConversation(true)');
  assert.equal(run('conversationMessages.size'), 2);
  assert.equal(run('conversationPage.hasMore'), false);
  assert.match(elements.get('#wat-export-status').textContent, /Fim do histórico/);
  assert.equal(elements.get('#wat-export-txt').disabled, false);
});

test('parar preserva o lote atual; falha posterior preserva mensagens e libera exportacao', async () => {
  const { run, elements } = exportContext();
  run(`requestConversationPage = async () => { conversationStop = true; return {
    chatId:'chat',chatName:'Ana',before:'b',hasMore:true,messages:[{fullId:'b'}] }; };`);
  await run('loadConversation(true)');
  assert.equal(run('conversationMessages.size'), 1);
  assert.match(elements.get('#wat-export-status').textContent, /interrompida/);
  run(`requestConversationPage = async () => { throw Error('Tempo limite'); };`);
  await run('loadConversation(true)');
  assert.equal(run('conversationMessages.size'), 1);
  assert.match(elements.get('#wat-export-status').textContent, /Tempo limite/);
  assert.equal(elements.get('#wat-export-txt').disabled, false);
});

test('ponte identifica autores em grupos, mensagens proprias e legendas sem expor body de midia', async () => {
  const sent = [];
  let handler;
  const window = { addEventListener(_name, callback) { handler = callback; }, postMessage(data) { sent.push(data); } };
  const context = vm.createContext({ window, console, WPP: {
    version:'test', loader:{ onReady(callback) { callback(); } }, on() {},
    contact:{ async get(id) { return { name: id === 'ana@c.us' ? 'Ana' : 'Outro' }; } },
    chat:{ getActiveChat() { return {id:'grupo@g.us',name:'Grupo'}; }, async getMessages() { return [
      {id:'true_grupo@g.us_self',type:'chat',body:'Minha mensagem',t:300},
      {id:'false_grupo@g.us_audio',author:'ana@c.us',type:'ptt',body:'BASE64_PRIVADO',t:200},
      {id:'false_grupo@g.us_photo',author:'ana@c.us',type:'image',caption:'Uma foto',body:'BASE64_PRIVADO',t:100},
    ]; } },
  } });
  vm.runInContext(bridge, context);
  await handler({source:window,data:{source:'wat-ui',action:'conversation-history',requestId:'1'}});
  const result = sent.find(item => item.action === 'conversation-history-result');
  assert.equal(result.messages[0].contactName, 'Ana');
  assert.equal(result.messages[0].text, 'Uma foto');
  assert.equal(result.messages[1].text, '');
  assert.equal(result.messages[2].contactName, 'Você');
  assert.ok(!JSON.stringify(result).includes('BASE64_PRIVADO'));
  await handler({source:window,data:{source:'wat-ui',action:'conversation-history',requestId:'2',chatId:'outra'}});
  assert.match(sent.at(-1).error, /conversa aberta mudou/);
});
