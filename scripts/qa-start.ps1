param([int]$FrontendPort = 3001, [int]$BackendPort = 8001)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
. (Join-Path $PSScriptRoot 'service-helpers.ps1')
if ($FrontendPort -eq 3000 -or $BackendPort -eq 8000 -or $FrontendPort -eq $BackendPort) { throw 'QA ports must be distinct from the live application.' }
if (@(Get-NetTCPConnection -LocalPort $FrontendPort,$BackendPort -State Listen -ErrorAction SilentlyContinue).Count) { throw 'A QA port is already occupied. No process was stopped.' }
$taskLogs = Join-Path $taskRoot 'artifacts\qa'
New-Item -ItemType Directory -Force -Path $taskLogs | Out-Null
$taskDatabase = (Join-Path $taskLogs 'zhixu.db').Replace('\','/')
$env:DATABASE_URL = 'sqlite:///' + $taskDatabase
$env:ZHIXU_AUTH_DIR = Join-Path $taskLogs 'auth'
$env:ZHIXU_LEETCODE_AUTH_DIR = Join-Path $taskLogs 'leetcode-auth'
$env:ZHIXU_CONFIG_FILE = Join-Path $taskLogs '.env'
$env:AI_PROVIDER = 'api_key'
$env:AI_API_KEY = ''
$env:DEEPSEEK_API_KEY = ''
$env:CHATGPT_CALLBACK_PORT = "$BackendPort"
$env:ZHIXU_FRONTEND_PORT = "$FrontendPort"
$env:BACKEND_URL = "http://127.0.0.1:$BackendPort"
$env:NEXT_BUILD_DIR = '.next-qa'
Write-Host 'Building the isolated QA application...'
npm run build
if ($LASTEXITCODE -ne 0) { throw 'QA build failed.' }
$taskBackend = $null
$taskFrontend = $null
try {
    $taskAppDir = '"' + $taskRoot + '"'
    $taskBackend = Start-Process -FilePath (Join-Path $taskRoot '.venv\Scripts\python.exe') -ArgumentList @('-m','uvicorn','backend.main:app','--app-dir',$taskAppDir,'--host','127.0.0.1','--port',"$BackendPort",'--no-access-log') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogs 'backend.log') -RedirectStandardError (Join-Path $taskLogs 'backend-error.log')
    $taskNext = '"' + (Join-Path $taskRoot 'node_modules\next\dist\bin\next') + '"'
    $taskFrontend = Start-Process -FilePath (Get-Command node).Source -ArgumentList @($taskNext,'start','--hostname','127.0.0.1','--port',"$FrontendPort") -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogs 'frontend.log') -RedirectStandardError (Join-Path $taskLogs 'frontend-error.log')
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 45; $taskAttempt++) {
        if ($taskBackend.HasExited -or $taskFrontend.HasExited) { throw 'A QA service exited before readiness.' }
        try { if ((Invoke-RestMethod "http://127.0.0.1:$FrontendPort/api/health").status -eq 'ok') { $taskReady = $true; break } } catch {}
        Start-Sleep -Milliseconds 500
    }
    if (-not $taskReady) { throw 'QA services did not become ready.' }
    Write-Host "QA ready: http://127.0.0.1:$FrontendPort (isolated database and credentials)."
    while (-not $taskBackend.HasExited -and -not $taskFrontend.HasExited) { Start-Sleep -Seconds 1 }
    $taskExited = if ($taskBackend.HasExited) { "backend (exit $($taskBackend.ExitCode))" } else { "frontend (exit $($taskFrontend.ExitCode))" }
    throw "QA $taskExited stopped unexpectedly. Check artifacts/qa/*-error.log."
} finally {
    Stop-ZhixuLaunchedProcess $taskFrontend $taskRoot
    Stop-ZhixuLaunchedProcess $taskBackend $taskRoot
}
