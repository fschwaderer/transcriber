# WhatsApp Audio Transcriber

Aplicação local para detectar novas mensagens de voz recebidas no WhatsApp Web, baixar o áudio com WA-JS e enviá-lo a um backend Node.js. A transcrição real roda localmente com faster-whisper, sem API paga e sem enviar o áudio a terceiros.

## Requisitos

- Windows com Node.js 20 ou mais recente
- Python 3.9 ou mais recente
- Chrome ou Edge
- Tampermonkey
- Uma sessão ativa no [WhatsApp Web](https://web.whatsapp.com/)

## Instalação e execução do backend

No PowerShell, baixe o projeto e entre na pasta:

```powershell
git clone https://github.com/fschwaderer/transcriber.git
Set-Location .\transcriber
```

Se não tiver o Git instalado, use **Code > Download ZIP** na página do repositório, extraia o arquivo e abra o PowerShell na pasta extraída.

Instale as dependências do backend:

```powershell
Set-Location .\server
npm install
```

Crie o ambiente Python local e instale o motor:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\python\requirements.txt
```

O ambiente `.venv`, as dependências e o modelo não ficam no GitHub; os comandos acima os preparam na máquina nova.

O arquivo `server/.env` já acompanha o projeto com esta configuração:

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

Inicie o servidor:

```powershell
npm start
```

Não é necessário ativar o ambiente Python antes de executar `npm start`: o backend chama diretamente `server/.venv/Scripts/python.exe`. Se quiser ativá-lo manualmente no PowerShell, o comando correto é `.\.venv\Scripts\Activate.ps1`.

Na primeira transcrição, o modelo é baixado para `server/models/.cache`; nas próximas, o cache local é reutilizado. Para testar sem carregar o modelo, defina `TRANSCRIPTION_PROVIDER=mock`.

O servidor escuta apenas em `127.0.0.1:3210`. Para reiniciar automaticamente durante o desenvolvimento, use `npm run dev`.

Teste a saúde no navegador em <http://127.0.0.1:3210/health>. O resultado esperado é:

```json
{"status":"ok"}
```

### Iniciar automaticamente com o Windows

Na pasta principal do projeto, execute `instalar-inicializacao-automatica.bat` uma vez. Ele cria um atalho na pasta **Inicializar** do usuário atual, sem exigir Visual Studio nem permissão de administrador, e inicia o servidor imediatamente.

A cada login, `start-transcriber.bat` consulta o endpoint `/health`. Se o servidor já estiver funcionando, ele não abre outro processo; se estiver parado, instala as dependências que faltarem e o inicia em segundo plano. Os logs ficam em `%LOCALAPPDATA%\WhatsAppTranscriber`.

Para desativar a inicialização automática, execute:

```bat
instalar-inicializacao-automatica.bat /remover
```

Se a pasta do projeto for movida, execute novamente o instalador para atualizar o caminho do atalho.

Também é possível testar a rota simulada no PowerShell com qualquer arquivo de áudio:

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
