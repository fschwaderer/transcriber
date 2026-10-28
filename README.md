# Transcritor de áudios do WhatsApp

Transforma mensagens de voz do **WhatsApp Web** em texto no seu próprio computador. Não exige chave de API nem assinatura de um serviço de transcrição.

Este guia foi escrito para quem nunca programou. Você não precisa abrir um terminal, instalar Git ou digitar comandos para a instalação recomendada.

## O que você precisa

- Um computador **Intel ou AMD com Windows 10 ou 11 de 64 bits (x64)**. Esta instalação não atende Windows de 32 bits nem Windows ARM.
- Google Chrome ou Microsoft Edge e uma conta do WhatsApp.
- Internet para instalar e baixar o modelo de transcrição na primeira utilização.
- Espaço livre para o programa, suas dependências e o modelo; reserve alguns GB. O desempenho depende do computador.

O instalador baixa **Node.js 22** e, se não encontrar um Python 3.13 x64 instalado, **Python 3.13.17 de 64 bits**, sem exigir que você escolha as versões. O Python novo fica numa pasta própria do usuário e o Node fica dentro do projeto. Uma instalação existente de Python 3.13 x64 pode ser reutilizada; não é preciso desinstalar outras versões.

## 1. Baixar e guardar o programa

1. Abra [a página do projeto no GitHub](https://github.com/fschwaderer/transcriber).
2. Clique no botão verde **Code** e depois em **Download ZIP**. Também pode [baixar o ZIP diretamente](https://github.com/fschwaderer/transcriber/archive/refs/heads/main.zip).
3. Abra a pasta **Downloads**, clique com o botão direito no ZIP e escolha **Extrair tudo**.
4. Guarde a pasta extraída em um lugar fixo, por exemplo `Documentos\Transcriber`. Abra essa pasta; nela devem aparecer `instalar.bat`, `README.md` e as pastas `browser`, `scripts` e `server`.

**Não execute de dentro do ZIP.** Não apague nem mova essa pasta depois de instalar: o início automático depende dela. Evite pastas sincronizadas com OneDrive para não sincronizar modelos e dependências grandes.

## 2. Instalar com dois cliques

1. Dê dois cliques em **instalar.bat**. Se o Explorador esconder as extensões, ele pode aparecer apenas como **instalar**, com tipo “Arquivo em Lotes do Windows”.
2. Uma janela vai mostrar o andamento. Aguarde até aparecer **Instalacao concluida!**. Os downloads podem levar vários minutos. Não feche a janela durante a instalação.
3. Pressione uma tecla quando for solicitado para fechar a janela.
4. Abra [a verificação do programa](http://127.0.0.1:3210/health). Se aparecer um texto contendo `"status":"ok"`, o servidor local está funcionando.

O instalador baixa as ferramentas de sites oficiais, verifica o download do Node e a assinatura do instalador do Python, instala as bibliotecas de áudio, cria `server/.env` a partir do exemplo quando necessário e configura o início automático **quando o usuário atual entrar no Windows**. Ele inicia o servidor imediatamente, em segundo plano. Não é necessário deixar essa janela aberta.

É normal aparecer `"worker":{"status":"stopped"...}` na verificação antes do primeiro áudio: o motor só carrega quando precisa transcrever. O servidor funcionar ainda não significa que a extensão do navegador esteja instalada; faça a próxima etapa.

Se a instalação falhar, leia a última mensagem de erro. Confira a internet e execute **instalar.bat** novamente. Suas configurações existentes são preservadas. Consulte também a seção de problemas abaixo.

## 3. Preparar o navegador (uma vez)

Esta parte precisa ser feita por você: o programa não instala extensões nem concede permissões no navegador automaticamente.

1. No Chrome ou Edge, abra [o site oficial do Tampermonkey](https://www.tampermonkey.net/) e escolha a extensão para seu navegador. Instale-a pela loja oficial. O Tampermonkey permite executar os dois scripts que adicionam o transcritor ao WhatsApp.
2. No menu de extensões do navegador, abra **Gerenciar extensões**, encontre **Tampermonkey** e clique em **Detalhes**. Ative **Permitir scripts de usuário**, se essa opção aparecer. Se não aparecer, consulte [a orientação oficial sobre o modo de desenvolvedor](https://www.tampermonkey.net/faq.php#Q209).
3. Com o Tampermonkey instalado, abra [Instalar ponte do WhatsApp](https://raw.githubusercontent.com/fschwaderer/transcriber/main/browser/whatsapp-transcriber-wa-bridge.user.js). Na tela do Tampermonkey, clique em **Instalar**.
4. Abra [Instalar painel do transcritor](https://raw.githubusercontent.com/fschwaderer/transcriber/main/browser/whatsapp-transcriber.user.js) e clique em **Instalar** novamente.
5. Se o navegador apenas mostrar o código: abra o menu do Tampermonkey, escolha **Criar novo script**, apague o conteúdo inicial e cole o conteúdo completo do arquivo correspondente da pasta `browser`. Salve com **Ctrl+S**. Repita para o outro arquivo.
6. No painel do Tampermonkey, confira se **WhatsApp Audio Transcriber - WA Bridge** e **WhatsApp Audio Transcriber** estão habilitados. São necessários **os dois**.
7. Abra [WhatsApp Web](https://web.whatsapp.com/). Se necessário, use o celular para ler o QR Code em **Aparelhos conectados**. Recarregue a página com **Ctrl+R** se já estava aberta.
8. Se o Tampermonkey pedir autorização para acessar **127.0.0.1**, permita. Esse endereço representa o seu próprio computador.

O painel **Transcritor** deve aparecer no WhatsApp e informar que o backend está conectado. “Backend” é apenas o programa local que faz a transcrição.

## 4. Fazer a primeira transcrição

1. Abra uma conversa que tenha um áudio recebido.
2. No painel **Transcritor**, clique em **Buscar áudios da conversa**.
3. Marque um áudio e clique em **Transcrever selecionados**.
4. Aguarde o texto aparecer. **Na primeira vez, o programa baixa o modelo de reconhecimento de voz**, o que pode demorar vários minutos. Nas seguintes, ele reutiliza esse download.

Novos áudios recebidos também entram na fila automaticamente enquanto o WhatsApp Web e os scripts estiverem ativos. Apenas o servidor inicia com o Windows: **você ainda precisa abrir o navegador e entrar no WhatsApp Web**. O programa não abre o navegador nem entra na conta sozinho.

Para mensagens mais antigas, abra a conversa e use **Buscar mais antigos**. Cada busca consulta até 100 mensagens, incluindo texto, então um lote sem áudios não significa que o histórico terminou. O programa não recupera mídias apagadas ou indisponíveis no WhatsApp.

Você pode arrastar o cabeçalho do painel para mudar sua posição. Use **↺** para restaurar a posição. A busca pode ser recolhida e ter sua altura ajustada com **−** e **+**. O botão **Logs** mostra informações úteis quando algo falha.

## Usar no dia a dia

| O que você quer fazer | O que abrir na pasta do programa |
| --- | --- |
| Usar normalmente depois de entrar no Windows | Basta abrir o WhatsApp Web; o servidor inicia sozinho. |
| Iniciar o servidor manualmente | `start-transcriber.bat` |
| Parar o servidor agora | `stop-transcriber.bat` — interrompe transcrições em andamento. |
| Desativar o início com o Windows | `remover-inicializacao-automatica.bat` |
| Reativar o início com o Windows | `instalar-inicializacao-automatica.bat` |
| Reparar a instalação ou atualizar dependências | Pare o servidor e execute `instalar.bat` novamente. |

Desativar o início automático não encerra o servidor que já está ativo. Para isso, use também **stop-transcriber.bat**. Se você moveu a pasta, execute novamente **instalar.bat** no novo local para atualizar o atalho e recriar o ambiente Python caso necessário.

O início automático vale para o usuário que fez a instalação, ao entrar na conta do Windows. Não é um serviço ativo antes do login. O servidor inicia oculto e não reinstala dependências a cada login. Ao iniciar manualmente de novo, verifica se já está ativo para evitar duplicação.

## Se precisar instalar Python manualmente

**No caminho recomendado, você não precisa fazer isso.** Se houver um bloqueio no instalador automático:

1. Use a [página oficial do Python 3.13.17](https://www.python.org/downloads/release/python-31317/) ou [este instalador direto para Windows x64](https://www.python.org/ftp/python/3.13.17/python-3.13.17-amd64.exe).
2. Escolha **Windows installer (64-bit)**. Não escolha 32-bit, ARM64, embeddable, pacote de código-fonte ou versão experimental/free-threaded.
3. No instalador, marque **Add python.exe to PATH**, mantenha **pip**, **venv** e o launcher **py** habilitados e clique em **Install Now**.
4. Para instalação manual por terminal, use **explicitamente `py -3.13`**, conforme os comandos abaixo. Apenas `python` pode apontar para outra versão.

A série usada neste projeto é **Python 3.13 de 64 bits**. Não baixe simplesmente “o Python mais recente”: uma versão mais nova pode não ter todas as bibliotecas de áudio prontas para Windows. As bibliotecas são instaladas como pacotes binários; não é necessário instalar Visual Studio nem compilar FFmpeg.

## Problemas comuns

| O que aconteceu | Como resolver |
| --- | --- |
| Dei dois cliques e não instalou | Extraia o ZIP primeiro. Confira se abriu `instalar.bat` da pasta que contém `server` e `scripts`. Leia a mensagem no final da janela. |
| Download falhou | Confira a internet e tente novamente. Redes corporativas podem bloquear Python.org, nodejs.org, PyPI ou Hugging Face; nesse caso, peça ajuda ao responsável pela rede. |
| Erro de DLL, `VCRUNTIME` ou motor Python não carrega | Instale o [Microsoft Visual C++ Redistributable x64 oficial](https://aka.ms/vs/17/release/vc_redist.x64.exe) e execute `instalar.bat` novamente. Esse componente pode pedir permissão de administrador. |
| Backend desconectado | Execute `start-transcriber.bat` e abra [a verificação local](http://127.0.0.1:3210/health). Se falhar, execute `instalar.bat`. Autorize `127.0.0.1` no Tampermonkey. |
| O painel não aparece | Confira se os dois scripts estão habilitados e se **Permitir scripts de usuário** está ativo nos detalhes da extensão. Recarregue o WhatsApp Web. |
| O primeiro áudio demora muito | O modelo precisa ser baixado e carregado. Confira a internet e clique em **Logs** no painel. Cada pedido tem limite de 10 minutos; tente de novo se o download inicial exceder esse prazo. |
| O programa não iniciou com o Windows | Execute `instalar-inicializacao-automatica.bat` novamente. Confira se o aplicativo não foi desabilitado em **Configurações → Aplicativos → Inicialização** e se a pasta não foi movida. |
| Porta em uso / `EADDRINUSE` | Se a verificação local responder, o programa pode já estar ativo. Encerre a instância anterior com `stop-transcriber.bat`; se foi iniciada manualmente num terminal, use **Ctrl+C** nesse terminal. |
| Um áudio antigo não aparece | Abra a conversa correta e use **Buscar mais antigos**. A mídia precisa continuar disponível no WhatsApp. |

Para encontrar os arquivos de registro, pressione **Windows+R**, cole `%LOCALAPPDATA%\WhatsAppTranscriber` e pressione Enter. Consulte `server.log`, `server-error.log` e, se houver falha ao iniciar, `startup-error.log`. Eles ajudam a descobrir o erro; não publique logs sem revisar os dados pessoais.

## Atualizar ou remover

**Atualizar:** execute `stop-transcriber.bat`, baixe o ZIP novo, extraia-o e copie os arquivos para a mesma pasta da instalação. Preserve `server/.env`. Execute `instalar.bat` novamente e atualize os dois scripts no Tampermonkey pelos links acima; confirme a instalação/atualização e recarregue o WhatsApp Web.

**Remover:** execute `remover-inicializacao-automatica.bat`, depois `stop-transcriber.bat`, remova os dois scripts no Tampermonkey e apague a pasta do projeto. O Python dedicado pode ser removido em **Configurações → Aplicativos → Aplicativos instalados**: confira o local `%LOCALAPPDATA%\Programs\WhatsAppTranscriber\Python313` antes de remover para não desinstalar outro Python. Os registros ficam em `%LOCALAPPDATA%\WhatsAppTranscriber` e podem ser apagados separadamente.

## Privacidade e limitações

O áudio é obtido do WhatsApp e enviado ao servidor local em `127.0.0.1`. A transcrição é executada no computador com faster-whisper, sem API externa de transcrição. Instalar dependências, carregar WA-JS e baixar o modelo exigem internet. A integração usa uma biblioteca externa WA-JS e pode precisar de ajustes quando o WhatsApp Web mudar. Não é um produto oficial do WhatsApp.

Os resultados, a fila e os diagnósticos do painel ficam em memória e são perdidos ao recarregar a página. Os áudios são processados em memória, limitados a 25 MB por pedido. Não há banco de dados nem exportação automática. Revise o texto: a qualidade depende do áudio e do modelo.

## Informações para quem desenvolve

- `browser/whatsapp-transcriber-wa-bridge.user.js`: WA-JS, histórico e download do áudio.
- `browser/whatsapp-transcriber.user.js`: painel, fila e comunicação com o servidor.
- `server/src/index.js`: servidor HTTP Express.
- `server/python/faster_whisper_worker.py`: motor Python persistente.
- `scripts/install.ps1`: instalação, verificação e início automático.

Instalação manual, a partir da pasta do projeto, em PowerShell com Node.js 22 e Python 3.13 x64 instalados:

```powershell
Copy-Item server/.env.example server/.env  # somente se .env ainda nao existir
Set-Location server
npm.cmd ci
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --only-binary=:all: -r python/requirements.txt
npm.cmd start
```

A configuração padrão usa português (`TRANSCRIPTION_LANGUAGE=pt`), modelo `small`, CPU e `int8`. Edite `server/.env` e reinicie para aplicar mudanças. Os arquivos `.env`, ambientes, modelos e dependências não são publicados no GitHub. `WHISPER_PYTHON` permite definir outro executável; o padrão é `server/.venv/Scripts/python.exe`.

`GET /health` mostra saúde e estado do motor, `GET /diagnostics` mostra eventos e `POST /transcribe` recebe um arquivo `audio/*` no campo `audio` de um formulário multipart. `TRANSCRIPTION_PROVIDER=mock` retorna texto fixo para testar a integração sem carregar modelo; o uso normal é `faster-whisper`.

Mantenha `HOST=127.0.0.1` e `PORT=3210` para a instalação recomendada. Se mudar a porta, ajuste também os endereços no userscript. Os scripts de inicialização leem host e porta do `.env`. O modelo é baixado sob demanda para `server/models/.cache`.
