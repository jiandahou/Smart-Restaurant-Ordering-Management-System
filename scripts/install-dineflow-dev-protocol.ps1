$ErrorActionPreference = 'Stop'

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
    throw 'The DineFlow development protocol can only be installed on Windows.'
}

$handlerPath = Join-Path $PSScriptRoot 'dineflow-dev-protocol.ps1'
if (-not (Test-Path -LiteralPath $handlerPath)) {
    throw "Protocol handler was not found at $handlerPath"
}

$powershellPath = (Get-Command 'powershell.exe' -ErrorAction Stop).Source
$protocolRoot = 'Registry::HKEY_CURRENT_USER\Software\Classes\dineflow-dev'
$commandKey = Join-Path $protocolRoot 'shell\open\command'
$quote = [char]34
$openCommand = "$quote$powershellPath$quote -NoProfile -ExecutionPolicy Bypass -File $quote$handlerPath$quote $quote%1$quote"

New-Item -Path $commandKey -Force | Out-Null
Set-Item -Path $protocolRoot -Value 'URL:DineFlow Development Tools'
New-ItemProperty -Path $protocolRoot -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
Set-Item -Path $commandKey -Value $openCommand

Write-Host 'Installed dineflow-dev:// protocol handler for the current Windows user.'
