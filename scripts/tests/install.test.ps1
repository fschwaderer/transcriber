$ErrorActionPreference = 'Stop'
$project = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$sandbox = Join-Path ([IO.Path]::GetTempPath()) ('Transcriber-install-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path "$sandbox\scripts", "$sandbox\.runtime\node", "$sandbox\bin", "$sandbox\localappdata" -Force | Out-Null

# Reproduz o launcher presente, mas sem o runtime 3.13 instalado.
Add-Type -TypeDefinition @'
using System;
public class MissingPython {
    public static int Main(string[] args) {
        Console.Error.WriteLine("[ERROR] No runtime installed that matches 3.13. Try running py install 3.13.");
        return 1;
    }
}
'@ -OutputAssembly "$sandbox\bin\py.exe" -OutputType ConsoleApplication

# Impede downloads/instalacoes reais. O teste deve chegar ao download Python.
New-Item -ItemType File -Path "$sandbox\.runtime\node\node.exe" | Out-Null
$installer = [IO.File]::ReadAllText((Join-Path $project 'scripts\install.ps1'))
$download = "Get-Download 'https://www.python.org/ftp/python/3.13.17/python-3.13.17-amd64.exe' `$installer"
if (-not $installer.Contains($download)) { throw 'O ponto de verificacao do teste precisa ser atualizado.' }
$installer = $installer.Replace($download, "throw 'TEST_PYTHON_DOWNLOAD_REACHED'")
[IO.File]::WriteAllText("$sandbox\scripts\install.ps1", $installer)
$oldPath = $env:PATH
$oldLocal = $env:LOCALAPPDATA
try {
    $env:PATH = "$sandbox\bin;$env:PATH"
    $env:LOCALAPPDATA = "$sandbox\localappdata"
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$sandbox\scripts\install.ps1" 2>&1 | Out-String
    if ($output -notmatch 'TEST_PYTHON_DOWNLOAD_REACHED') { throw "O instalador nao continuou para o download: $output" }
    if ($output -match 'ERRO:.*No runtime installed') { throw "O erro do launcher interrompeu o instalador: $output" }
    Write-Host 'PASS: launcher sem Python 3.13 nao impede a instalacao automatica.'
} finally {
    $env:PATH = $oldPath
    $env:LOCALAPPDATA = $oldLocal
}
