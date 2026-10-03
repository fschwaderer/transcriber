# WhatsApp Audio Transcriber

Aplicação local para detectar novas mensagens de voz recebidas no WhatsApp Web, baixar o áudio com WA-JS e enviá-lo a um backend Node.js. A transcrição real roda localmente com faster-whisper, sem API paga e sem enviar o áudio a terceiros.

## Requisitos

- Windows com Node.js 20 ou mais recente
- Python 3.9 ou mais recente
- Chrome ou Edge
- Tampermonkey
- Uma sessão ativa no [WhatsApp Web](https://web.whatsapp.com/)

## Instalação passo a passo (Windows)

### 1. Preparar o computador

Instale Node.js 20 ou mais recente (com npm), Python 3.9 ou mais recente e Chrome ou Edge. No instalador do Python, habilite **Add Python to PATH**. Instale a extensão Tampermonkey no navegador. Git é necessário somente para baixar e atualizar pelo terminal.

Abra um novo PowerShell após instalar e confira:

```powershell
node --version
npm.cmd --version
python --version
git --version
```

Se o Windows disponibilizar somente o comando `py`, use `py -3` no lugar de `python` ao criar o ambiente virtual.

### 2. Baixar o projeto

No PowerShell, baixe o projeto e entre na pasta:

```powershell
git clone https://github.com/fschwaderer/transcriber.git
Set-Location .\transcriber
```

Se não tiver o Git instalado, use **Code > Download ZIP** na página do repositório, extraia o arquivo e abra o PowerShell na pasta extraída.

### 3. Instalar as dependências do Node.js

Na pasta do projeto, instale as versões registradas no arquivo de dependências:

```powershell
Set-Location .\server
npm.cmd ci
```

### 4. Instalar o motor de transcrição

Ainda na pasta `server`, crie o ambiente Python local e instale o motor:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\python\requirements.txt
```

O ambiente `.venv`, as dependências e o modelo não ficam no GitHub; os comandos acima os preparam na máquina nova.

### 5. Conferir a configuração

O arquivo `server/.env` já acompanha o projeto com configuração local sem chaves de API. Caso esteja ausente, crie-o a partir do exemplo (ainda na pasta `server`):

```powershell
Copy-Item .env.example .env
```

As principais opções são:

```dotenv
TRANSCRIPTION_PROVIDER=faster-whisper
TRANSCRIPTION_LANGUAGE=pt
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_CPU_THREADS=0
HF_HOME=./models/.cache
HF_HUB_DISABLE_XET=1
```

### 6. Iniciar e verificar o servidor

Ainda na pasta `server`, inicie o servidor e mantenha o terminal aberto:

```powershell
npm.cmd start
```

Não é necessário ativar o ambiente Python antes de executar `npm start`: o backend chama diretamente `server/.venv/Scripts/python.exe`. Se quiser ativá-lo manualmente no PowerShell, o comando correto é `.\.venv\Scripts\Activate.ps1`.

Na primeira transcrição, o modelo é baixado para `server/models/.cache`; nas próximas, o cache local é reutilizado. Para testar sem carregar o modelo, defina `TRANSCRIPTION_PROVIDER=mock`.

O servidor escuta em `127.0.0.1:3210` por padrão. Para reiniciar automaticamente durante o desenvolvimento, use `npm.cmd run dev`.

Teste a saúde no navegador em <http://127.0.0.1:3210/health>. A resposta deve conter `status: "ok"`; antes da primeira transcrição, o exemplo é:

```json
{"status":"ok","uptimeSeconds":5,"provider":"faster-whisper","worker":{"status":"stopped","model":"small","device":"cpu","startedAt":null,"readyAt":null,"lastError":null},"pendingRequests":0}
```

`worker.status: "stopped"` é normal antes do primeiro áudio: o modelo só é carregado quando uma transcrição é solicitada. `uptimeSeconds` varia conforme o tempo de execução.

### 7. Instalar os dois scripts no navegador

Siga a seção [Instalação do userscript](#instalação-do-userscript) abaixo. Ambos são necessários. Depois de salvar e habilitar os dois, recarregue o WhatsApp Web.

### 8. Fazer a primeira transcrição

Com o backend ativo, abra uma conversa e clique em **Buscar áudios da conversa**, selecione um áudio recebido e clique em **Transcrever selecionados**. Outra opção é receber uma nova mensagem de voz. Aguarde o download e o carregamento do modelo na primeira execução; acompanhe o painel e o botão **Logs**. O texto deve aparecer no painel.

### 9. Configurar a inicialização automática (opcional)

Para executar em segundo plano sem manter um terminal aberto, volte à pasta principal e execute `start-transcriber.bat`. Ele também prepara dependências ausentes. Encerre antes com **Ctrl+C** uma instância iniciada manualmente.

Na pasta principal do projeto, execute `instalar-inicializacao-automatica.bat` uma vez. Ele cria um atalho na pasta **Inicializar** do usuário atual, sem exigir Visual Studio nem permissão de administrador, e inicia o servidor imediatamente.

A cada login, `start-transcriber.bat` consulta o endpoint `/health`. Se o servidor já estiver funcionando, ele não abre outro processo; se estiver parado, instala as dependências que faltarem e o inicia em segundo plano. Os logs ficam em `%LOCALAPPDATA%\WhatsAppTranscriber`.

Para desativar a inicialização automática, execute:

```bat
instalar-inicializacao-automatica.bat /remover
```

Para parar o backend iniciado pelo `start-transcriber.bat`, execute **stop-transcriber.bat**. Ele encerra também o worker de transcrição; transcrições em andamento serão interrompidas. Para voltar a usar, execute `start-transcriber.bat` novamente. A parada não remove a inicialização automática no próximo login.

O comando de parada identifica o servidor pelo caminho completo usado pelo BAT atualizado. Uma execução iniciada pelo BAT antigo deve ser encerrada uma vez pelo Gerenciador de Tarefas (processo Node.js deste servidor); para execuções manuais em um terminal, use **Ctrl+C**. Depois, inicie pelo BAT atualizado.

Se a pasta do projeto for movida, execute novamente o instalador para atualizar o caminho do atalho.

Também é possível testar a rota no PowerShell com um arquivo de áudio real. Com `TRANSCRIPTION_PROVIDER=mock`, ela devolve um texto fixo e verifica apenas a integração HTTP; com `faster-whisper`, executa a transcrição real:

```powershell
curl.exe -X POST -F "audio=@C:\caminho\para\audio.ogg;type=audio/ogg" http://127.0.0.1:3210/transcribe
```

## Instalação do userscript

1. Instale a extensão Tampermonkey no Chrome ou Edge.
2. Crie um script com todo o conteúdo de `browser/whatsapp-transcriber-wa-bridge.user.js` e salve. Essa ponte roda WA-JS com `@grant none`.
3. Crie outro script com todo o conteúdo de `browser/whatsapp-transcriber.user.js` e salve. Esse script controla a interface, a fila e o backend.
4. Autorize o segundo script a acessar `127.0.0.1`; isso é usado exclusivamente para chamar o backend local.
5. Confirme que os dois scripts estão habilitados e que o backend está em execução.
6. Abra ou recarregue <https://web.whatsapp.com/>.

Ao carregar o WhatsApp, o cabeçalho do painel mostra se o backend está conectado. Durante uma transcrição, ele também informa se o modelo Whisper está carregando ou pronto. Cada áudio passa pelas etapas **Na fila**, **Baixando áudio**, **Enviando ao backend** e **Transcrevendo no Whisper**, esta última com um contador de segundos.

O botão **Logs** abre os últimos eventos do servidor dentro do próprio WhatsApp, incluindo recebimento do arquivo, carregamento do modelo, fila, conclusão e erros. O console do navegador continua mostrando logs com os prefixos `[TRANSCRIBER:*]`.

Os dois userscripts se comunicam apenas dentro da aba usando `window.postMessage`. Essa separação é necessária porque WA-JS precisa do contexto da página (`@grant none`), enquanto o acesso HTTP local precisa de `GM_xmlhttpRequest`. O sistema processa somente mensagens novas do tipo `ptt` ou `audio`, ignora mensagens próprias, evita IDs duplicados e trabalha com um áudio por vez. Se o backend estiver desligado, o WhatsApp continua operando e o painel oferece **Tentar novamente**.

### Mover o painel

Arraste o cabeçalho **🎤 Transcritor** para mover o painel e acessar informações atrás dele. O botão **↺** no cabeçalho devolve o painel à posição original, no canto superior direito. Também é possível mover o painel minimizado; ao recarregar a página, ele volta à posição original.

Para receber essa atualização, substitua o conteúdo do script **WhatsApp Audio Transcriber** no Tampermonkey pelo arquivo `browser/whatsapp-transcriber.user.js`, salve e recarregue o WhatsApp Web.

### Transcrever áudios recebidos enquanto o programa estava parado

A busca começa recolhida. O botão **Buscar áudios da conversa** permanece visível e abre os resultados ao iniciar a busca. Use **−** e **+** para ajustar a altura ou **Recolher / Expandir** para minimizar e restaurar somente a busca. A área mantém seu espaço mesmo com muitas transcrições, respeitando a altura da janela. As seleções são preservadas ao recolher; os ajustes de altura valem durante a sessão.

Atualize **os dois userscripts** no Tampermonkey com os arquivos da pasta `browser` e recarregue o WhatsApp Web.

1. Inicie o backend e abra a conversa desejada no WhatsApp Web.
2. No painel, clique em **Buscar áudios da conversa**.
3. Marque os áudios pela data, remetente e duração e clique em **Transcrever selecionados**.
4. Para alcançar um período anterior, clique em **Buscar mais antigos**. Cada busca consulta até 100 mensagens, incluindo mensagens de texto; um lote sem áudios não significa que o histórico terminou.

A busca inclui áudios recebidos já lidos e não depende de o Transcriber estar ativo no momento do recebimento. Ela usa o histórico disponível no WhatsApp Web; mídias apagadas ou indisponíveis para download não podem ser recuperadas pelo Transcriber. Buscar apenas lista as mensagens; o áudio é baixado e enviado ao backend ao entrar na fila.

Áudios já na fila ou concluídos nesta sessão ficam desabilitados na seleção. Se uma tentativa falhar, é possível selecioná-la novamente ou usar **Tentar novamente** no painel. A fila e o controle de duplicados ficam em memória: recarregar a página inicia uma nova sessão. Ao mudar de conversa, clique novamente em **Buscar áudios da conversa**.

## Arquitetura

```text
WhatsApp Web
  → WA-JS: chat.new_message
  → fila do userscript
  → WPP.chat.downloadMedia(fullId)
  → POST multipart/form-data /transcribe
  → worker Python persistente (faster-whisper ou mock)
  → painel no WhatsApp Web
```

Os arquivos são mantidos em memória pelo Multer, limitados a 25 MB e não são gravados em disco. O Node envia o áudio codificado ao worker Python pela entrada padrão; o modelo permanece carregado entre transcrições e devolve o texto pela saída padrão. Tanto `.venv` quanto os modelos locais são ignorados pelo Git.

## Endpoints

- `GET /health` — retorna o estado do servidor, do worker Whisper e a quantidade de requisições pendentes.
- `GET /diagnostics` — retorna o estado atual e os últimos eventos de diagnóstico em memória.
- `POST /transcribe` — exige um arquivo de áudio no campo `audio` e retorna a transcrição configurada.

Não coloque segredos no userscript. O `.env` incluído contém somente configurações locais e nenhuma chave de API.

## Organização do projeto

| Caminho | Responsabilidade |
| --- | --- |
| `browser/whatsapp-transcriber-wa-bridge.user.js` | Integração WA-JS, eventos, histórico e download da mídia no contexto da página. |
| `browser/whatsapp-transcriber.user.js` | Painel, busca, fila, chamadas HTTP ao backend e diagnósticos. |
| `server/src/index.js` | Servidor Express, CORS, saúde e tratamento de erros. |
| `server/src/routes/transcribe.js` | Recebimento multipart do áudio e resposta com texto. |
| `server/src/services/transcription.js` | Inicialização e comunicação com o worker Python persistente. |
| `server/src/services/diagnostics.js` | Eventos de diagnóstico em memória. |
| `server/python/faster_whisper_worker.py` | Carregamento do modelo e transcrição local. |
| `start-transcriber.bat` / `stop-transcriber.bat` | Iniciar em segundo plano e encerrar o backend e seu worker. |
| `instalar-inicializacao-automatica.bat` | Instalar ou remover o atalho de inicialização no Windows. |

## Configuração do backend

Edite `server/.env` e reinicie o backend para aplicar mudanças.

| Variável | Valor incluído | Uso |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Endereço de escuta local. |
| `PORT` | `3210` | Porta HTTP. |
| `TRANSCRIPTION_PROVIDER` | `faster-whisper` | Motor real; `mock` retorna um texto fixo para teste. Sem configuração, o código usa `mock`. |
| `TRANSCRIPTION_LANGUAGE` | `pt` | Idioma enviado ao modelo. O prompt do worker foi escrito para português brasileiro. |
| `WHISPER_MODEL` | `small` | Nome do modelo ou caminho de um modelo local compatível. |
| `WHISPER_DEVICE` | `cpu` | Dispositivo usado pelo modelo. |
| `WHISPER_COMPUTE_TYPE` | `int8` | Tipo de cálculo do modelo. |
| `WHISPER_CPU_THREADS` | `0` | Quantidade de threads; `0` deixa a escolha ao motor. |
| `WHISPER_PYTHON` | não definido | Caminho alternativo do executável Python; por padrão usa `.venv`. |
| `HF_HOME` | `./models/.cache` | Cache local de modelos, relativo à pasta `server`. |
| `HF_HUB_DISABLE_SYMLINKS_WARNING` | `1` | Suprime o aviso de symlinks do cache. |
| `HF_HUB_DISABLE_XET` | `1` | Desabilita o mecanismo Xet no download do modelo. |

Se alterar host ou porta, ajuste também os endereços em `browser/whatsapp-transcriber.user.js` e o `@connect` quando necessário. Os BATs de início e verificação usam `127.0.0.1:3210`; atualize-os também se mudar esse endereço.

## Solução de problemas

| Sintoma | O que fazer |
| --- | --- |
| `node`, `npm` ou `python` não reconhecido | Confira a instalação e o PATH; abra um novo terminal. Para Python, teste `py -3 --version`. |
| PowerShell bloqueia `npm.ps1` | Use `npm.cmd ci` e `npm.cmd start`, como neste guia. |
| Backend desconectado no painel | Abra `/health`, confira o processo Node e autorize o acesso a `127.0.0.1` no Tampermonkey. |
| O painel ou a busca não funciona | Confira se os dois scripts estão habilitados e recarregue o WhatsApp Web. Consulte o console do navegador e o botão **Logs**. |
| Python/worker não inicia | Confira `server/.venv/Scripts/python.exe` e execute novamente a instalação de `python/requirements.txt`. |
| Primeira transcrição demora ou falha ao baixar o modelo | Confira a conexão com a internet e os logs. O prazo de cada requisição é de 10 minutos, incluindo o carregamento inicial. |
| `EADDRINUSE` | A porta já está ocupada. Confira `/health`; encerre a instância anterior com Ctrl+C ou `stop-transcriber.bat`, conforme a forma de início. |
| Áudio antigo não aparece | Abra a conversa correta e use **Buscar mais antigos**. A consulta depende do histórico disponível no WhatsApp Web. |
| Áudio indisponível | A ferramenta depende do download oferecido pelo WhatsApp; não recupera mídia apagada ou inacessível. |

Para o backend iniciado em segundo plano, consulte `%LOCALAPPDATA%\WhatsAppTranscriber\server.log` e `server-error.log`. Para execução manual, consulte o terminal.

## Atualizar o projeto

Na pasta principal, encerre o backend e execute:

```powershell
git pull --ff-only
Set-Location .\server
npm.cmd ci
.\.venv\Scripts\python.exe -m pip install -r .\python\requirements.txt
```

Atualize o conteúdo dos dois userscripts no Tampermonkey, reinicie o backend e recarregue o WhatsApp Web. Se instalou por ZIP, baixe a versão atual e refaça a instalação das dependências; preserve sua configuração local.

## Privacidade e limitações

A transcrição roda no computador. O áudio é obtido do WhatsApp e enviado ao backend local; o motor não utiliza uma API externa de transcrição. A instalação de dependências, o carregamento do WA-JS e o primeiro download do modelo exigem internet. A ponte carrega WA-JS de uma versão `nightly` externa e depende da compatibilidade dessa biblioteca com o WhatsApp Web.

O backend recebe um arquivo por requisição, de até 25 MB, com MIME `audio/*`, e retorna `{"success":true,"text":"..."}` em caso de sucesso. A fila, os resultados do painel e os diagnósticos são temporários; não há banco de dados nem exportação automática. A precisão depende do áudio e do modelo, portanto revise o texto antes de utilizá-lo.
