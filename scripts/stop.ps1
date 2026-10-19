$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'service-helpers.ps1')
Stop-ZhixuServices $taskRoot
Write-Host 'Zhixu services stopped. Learning data was preserved.' -ForegroundColor Green
