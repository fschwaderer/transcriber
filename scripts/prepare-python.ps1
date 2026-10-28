# Python/py podem escrever em stderr ao testar um ambiente invalido.
# Os codigos de saida sao verificados explicitamente abaixo.
$ErrorActionPreference = 'Continue'

try {
    $serverDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'server'
    $venvDirectory = Join-Path $serverDirectory '.venv'
    $venvPython = Join-Path $venvDirectory 'Scripts\python.exe'
    $requirements = Join-Path $serverDirectory 'python\requirements.txt'

    $pythonWorks = $false
    if (Test-Path -LiteralPath $venvPython) {
        & $venvPython -c 'import sys, struct; sys.exit(0 if sys.version_info[:2] == (3, 13) and struct.calcsize(chr(80)) == 8 else 1)' *> $null
        $pythonWorks = $LASTEXITCODE -eq 0
    }

    if (-not $pythonWorks) {
        Write-Host '[TRANSCRIBER] Preparando ambiente Python (ausente ou invalidado por uma atualizacao)...'
        $candidates = @(
            @{ Command = $env:TRANSCRIBER_PYTHON; Arguments = @() },
            @{ Command = (Join-Path $env:LOCALAPPDATA 'Programs\WhatsAppTranscriber\Python313\python.exe'); Arguments = @() },
            @{ Command = 'py.exe'; Arguments = @('-3.13') },
            @{ Command = 'python.exe'; Arguments = @() }
        )
        $selectedPython = $null
        foreach ($candidate in $candidates) {
            if (-not $candidate.Command -or -not (Get-Command $candidate.Command -ErrorAction SilentlyContinue)) { continue }
            $candidateArgs = $candidate.Arguments
            $executable = & $candidate.Command @candidateArgs -c 'import sys; print(sys.executable)' 2>$null
            if ($LASTEXITCODE -ne 0) { continue }
            & $executable -c 'import sys, struct; sys.exit(0 if sys.version_info[:2] == (3, 13) and struct.calcsize(chr(80)) == 8 else 1)' *> $null
            if ($LASTEXITCODE -ne 0) { continue }
            # Confirma a disponibilidade das dependencias nativas antes de alterar o ambiente.
            & $executable -m pip install --dry-run --only-binary=:all: -r $requirements *> $null
            if ($LASTEXITCODE -eq 0) {
                $selectedPython = $executable
                break
            }
        }
        if (-not $selectedPython) {
            throw 'Python 3.13 de 64 bits nao encontrado ou dependencias indisponiveis. Execute instalar.bat com acesso a internet.'
        }

        if (Test-Path -LiteralPath $venvDirectory) {
            $backupDirectory = Join-Path $serverDirectory ('temp\venv-backup-' + [guid]::NewGuid().ToString('N'))
            $resolvedServer = (Resolve-Path -LiteralPath $serverDirectory -ErrorAction Stop).Path + '\'
            foreach ($target in @($venvDirectory, $backupDirectory)) {
                if (-not [IO.Path]::GetFullPath($target).StartsWith($resolvedServer, [StringComparison]::OrdinalIgnoreCase)) {
                    throw 'O caminho do ambiente Python esta fora da pasta do servidor.'
                }
            }
            New-Item -ItemType Directory -Path (Split-Path $backupDirectory -Parent) -Force -ErrorAction Stop | Out-Null
            Move-Item -LiteralPath $venvDirectory -Destination $backupDirectory -ErrorAction Stop
            Write-Host "[TRANSCRIBER] Ambiente anterior preservado em $backupDirectory"
        }
        & $selectedPython -m venv $venvDirectory
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o ambiente virtual Python.' }
    }

    Write-Host '[TRANSCRIBER] Conferindo dependencias do Python. Isto pode demorar...'
    & $venvPython -m pip install --only-binary=:all: -r $requirements
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependencias do Python. Confira a internet e execute instalar.bat novamente.' }
    & $venvPython -c 'from faster_whisper import WhisperModel; import av; print(av.__version__)'
    if ($LASTEXITCODE -ne 0) { throw 'O motor nao carrega. Instale o Microsoft Visual C++ Redistributable x64 (link no README) e tente novamente.' }
    Write-Host '[TRANSCRIBER] Ambiente Python pronto.'
} catch {
    Write-Host "[TRANSCRIBER] $($_.Exception.Message)"
    exit 1
}
exit 0
