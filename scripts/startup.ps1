param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$linkPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'WhatsApp Transcriber.lnk'
if ($Remove) {
    if (Test-Path -LiteralPath $linkPath) { Remove-Item -LiteralPath $linkPath }
    Write-Host 'Inicializacao automatica removida. Para encerrar agora, execute stop-transcriber.bat.'
    return
}
$link = (New-Object -ComObject WScript.Shell).CreateShortcut($linkPath)
$link.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$link.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'start-transcriber.ps1') + '"'
$link.WorkingDirectory = $project
$link.WindowStyle = 7
$link.Description = 'Servidor local do WhatsApp Transcriber'
$link.Save()
Write-Host 'Inicializacao automatica configurada para o usuario atual.'
