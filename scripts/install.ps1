$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $project '.runtime'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

function Get-Download($url, $destination) {
    Write-Host "Baixando $url ..."
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $destination
}

try {
    if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
        throw 'Este instalador requer Windows 10/11 de 64 bits em computador Intel ou AMD (x64).'
    }
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    # Node fica somente nesta pasta: dispensa administrador e alteracoes no PATH do Windows.
    $node = Join-Path $runtime 'node'
    if (-not (Test-Path (Join-Path $node 'node.exe'))) {
        $base = 'https://nodejs.org/dist/latest-v22.x'
        $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
        $match = [regex]::Match($sums, '(?m)^([a-f0-9]{64})\s+(node-v22\.[0-9]+\.[0-9]+-win-x64\.zip)\s*$')
        if (-not $match.Success) { throw 'Nao foi possivel identificar o download oficial do Node.js 22.' }
        $zip = Join-Path $runtime $match.Groups[2].Value
        Get-Download "$base/$($match.Groups[2].Value)" $zip
        if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $match.Groups[1].Value) { throw 'Download do Node.js incompleto ou invalido. Execute novamente.' }
        Expand-Archive -LiteralPath $zip -DestinationPath $runtime -Force
        Rename-Item -LiteralPath (Join-Path $runtime ([IO.Path]::GetFileNameWithoutExtension($zip))) -NewName 'node'
    }
    $env:PATH = "$node;$env:PATH"

    # Uma instalacao dedicada evita selecionar por engano Python 3.15 ou 32 bits.
    $pythonDir = Join-Path $env:LOCALAPPDATA 'Programs\WhatsAppTranscriber\Python313'
    $python = Join-Path $pythonDir 'python.exe'
    if (-not (Test-Path -LiteralPath $python)) {
        if (Get-Command py.exe -ErrorAction SilentlyContinue) {
            # No Windows PowerShell 5.1, stderr nativo pode disparar o catch
            # com ErrorActionPreference=Stop, mesmo com 2>$null. A ausencia
            # do Python e esperada nesta consulta: deve levar ao download.
            $detected = & {
                $ErrorActionPreference = 'Continue'
                $candidate = & py.exe -3.13 -c 'import sys, struct; print(sys.executable) if struct.calcsize(chr(80)) == 8 else None' 2>$null
                if ($LASTEXITCODE -eq 0) { $candidate }
            }
            if ($detected -and (Test-Path -LiteralPath $detected)) { $python = $detected }
        }
        $standardPython = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'
        if (-not (Test-Path -LiteralPath $python) -and (Test-Path -LiteralPath $standardPython)) { $python = $standardPython }
    }
    if (-not (Test-Path -LiteralPath $python)) {
        $installer = Join-Path $runtime 'python-3.13.17-amd64.exe'
        Get-Download 'https://www.python.org/ftp/python/3.13.17/python-3.13.17-amd64.exe' $installer
        $signature = Get-AuthenticodeSignature -LiteralPath $installer
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Python Software Foundation') { throw 'A assinatura do instalador Python nao e valida.' }
        $arguments = '/quiet InstallAllUsers=0 Include_launcher=0 Include_test=0 Include_pip=1 PrependPath=0 TargetDir="' + $pythonDir + '"'
        $process = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
        if ($process.ExitCode -notin @(0, 3010)) { throw "Instalacao do Python falhou (codigo $($process.ExitCode))." }
    }
    if (-not (Test-Path -LiteralPath $python)) { throw 'Python nao foi encontrado apos instalar. Use a instalacao manual do README.' }
    & $python -c 'import sys, struct; sys.exit(0 if sys.version_info[:2] == (3, 13) and struct.calcsize(chr(80)) == 8 else 1)'
    if ($LASTEXITCODE -ne 0) { throw 'E necessario Python 3.13 de 64 bits. Consulte o README.' }
    $env:TRANSCRIBER_PYTHON = $python
    & "$PSScriptRoot\prepare-python.ps1"
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel preparar o motor Python.' }
    $server = Join-Path $project 'server'
    if (-not (Test-Path -LiteralPath (Join-Path $server '.env'))) {
        Copy-Item -LiteralPath (Join-Path $server '.env.example') -Destination (Join-Path $server '.env')
    }
    Push-Location $server
    try {
        & (Join-Path $node 'npm.cmd') ci --omit=dev
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependencias do servidor.' }
    } finally { Pop-Location }
    & "$PSScriptRoot\startup.ps1"
    & "$PSScriptRoot\start-transcriber.ps1"
    if ($LASTEXITCODE -ne 0) { throw 'O servidor nao iniciou. Consulte os logs.' }
    Write-Host 'Instalacao concluida! O servidor iniciara automaticamente quando voce entrar no Windows.'
    Write-Host 'Agora siga a etapa de instalacao do Tampermonkey e dos dois scripts no README.md.'
} catch {
    Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
exit 0
