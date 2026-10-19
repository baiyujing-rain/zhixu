param([int]$FrontendPort = 3021, [int]$BackendPort = 8021, [int]$ForeignPort = 3022)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'service-helpers.ps1')
$taskPorts = @($FrontendPort, $BackendPort, $ForeignPort)
if (@($taskPorts | Select-Object -Unique).Count -ne 3 -or @($taskPorts | Where-Object { $_ -in @(3000,8000,3001,8001) }).Count) { throw 'Lifecycle checks must use three separate, isolated ports.' }
if (@(Get-NetTCPConnection -LocalPort $taskPorts -State Listen -ErrorAction SilentlyContinue).Count) { throw 'A lifecycle check port is occupied. No service was stopped.' }
$taskExisting = @(Get-NetTCPConnection -LocalPort 3000,8000,3001,8001 -State Listen -ErrorAction SilentlyContinue | Sort-Object LocalPort | Select-Object LocalPort,OwningProcess)
$taskDir = Join-Path $taskRoot 'artifacts\qa\service-lifecycle'
New-Item -ItemType Directory -Force -Path $taskDir | Out-Null
$taskFixture = Join-Path $taskDir 'foreign-server.mjs'
[System.IO.File]::WriteAllText($taskFixture, "import http from 'node:http'; http.createServer((request,response)=>{response.setHeader('Content-Type','text/plain; charset=utf-8');response.end('foreign check');}).listen(Number(process.argv[2]),'127.0.0.1');")
$env:DATABASE_URL = 'sqlite:///' + (Join-Path $taskDir 'check.db').Replace('\','/')
$env:ZHIXU_AUTH_DIR = Join-Path $taskDir 'auth'
$env:ZHIXU_LEETCODE_AUTH_DIR = Join-Path $taskDir 'leetcode-auth'
$env:ZHIXU_CONFIG_FILE = Join-Path $taskDir '.env'
$env:AI_PROVIDER = 'api_key'
$env:AI_API_KEY = ''
$env:DEEPSEEK_API_KEY = ''
$env:NEXT_BUILD_DIR = '.next-qa'
$taskBackend = $null; $taskFrontend = $null; $taskForeign = $null; $taskForeignOrigin = $null
try {
    $taskAppDir = '"' + $taskRoot + '"'
    $taskNext = '"' + (Join-Path $taskRoot 'node_modules\next\dist\bin\next') + '"'
    $taskPython = Join-Path $taskRoot '.venv\Scripts\python.exe'
    $taskNode = (Get-Command node).Source
    $taskBackend = Start-Process $taskPython -ArgumentList @('-B','-m','uvicorn','backend.main:app','--app-dir',$taskAppDir,'--host','127.0.0.1','--port',"$BackendPort",'--no-access-log') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskDir 'backend.log') -RedirectStandardError (Join-Path $taskDir 'backend-error.log')
    $taskFrontend = Start-Process $taskNode -ArgumentList @($taskNext,'start','--hostname','127.0.0.1','--port',"$FrontendPort") -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskDir 'frontend.log') -RedirectStandardError (Join-Path $taskDir 'frontend-error.log')
    # The unrelated command contains the real Next path only as data.
    $taskForeign = Start-Process $taskNode -ArgumentList @(('"' + $taskFixture + '"'),"$ForeignPort",$taskNext,'start') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskDir 'foreign.log') -RedirectStandardError (Join-Path $taskDir 'foreign-error.log')
    $taskForeignOrigin = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskForeign.Id)"
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 45; $taskAttempt++) {
        if ($taskBackend.HasExited -or $taskFrontend.HasExited -or $taskForeign.HasExited) { throw 'A lifecycle fixture exited before readiness.' }
        try {
            $taskHealth = Invoke-RestMethod "http://127.0.0.1:$BackendPort/api/health" -TimeoutSec 2
            $taskWeb = Invoke-WebRequest "http://127.0.0.1:$FrontendPort" -UseBasicParsing -TimeoutSec 2
            $taskOther = Invoke-WebRequest "http://127.0.0.1:$ForeignPort" -UseBasicParsing -TimeoutSec 2
            if ($taskHealth.status -eq 'ok' -and $taskWeb.StatusCode -eq 200 -and $taskOther.Content -eq 'foreign check') { $taskReady = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    if (-not $taskReady) { throw 'Lifecycle fixtures did not become ready.' }
    Stop-ZhixuLaunchedProcess $taskForeign $taskRoot
    if ($taskForeign.HasExited) { throw 'An unrelated process was stopped.' }
    $taskRefused = $false
    try { Stop-ZhixuVerifiedProcessTree $taskForeignOrigin $taskRoot } catch { $taskRefused = $_.Exception.Message -like '*process changed before stopping*' }
    if (-not $taskRefused -or $taskForeign.HasExited) { throw 'Direct tree stopping did not refuse an unrelated process.' }
    Stop-ZhixuLaunchedProcess $taskFrontend $taskRoot
    Stop-ZhixuLaunchedProcess $taskBackend $taskRoot
    if (@(Get-NetTCPConnection -LocalPort $FrontendPort,$BackendPort -State Listen -ErrorAction SilentlyContinue).Count) { throw 'Owned fixtures did not release their ports.' }
    if ((Invoke-WebRequest "http://127.0.0.1:$ForeignPort" -UseBasicParsing -TimeoutSec 2).Content -ne 'foreign check') { throw 'The unrelated service was affected.' }
    $taskAfter = @(Get-NetTCPConnection -LocalPort 3000,8000,3001,8001 -State Listen -ErrorAction SilentlyContinue | Sort-Object LocalPort | Select-Object LocalPort,OwningProcess)
    if (($taskExisting | ConvertTo-Json -Compress) -ne ($taskAfter | ConvertTo-Json -Compress)) { throw 'Live or QA service identities changed during isolated lifecycle checks.' }
    @{ checked_at_utc = [DateTime]::UtcNow.ToString('o'); owned_frontend_stopped = $true; owned_backend_tree_stopped = $true; foreign_process_preserved = $true; live_and_qa_preserved = $true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskDir 'result.json') -Encoding UTF8
    Write-Host 'Lifecycle check passed: owned Node/Python services stopped, unrelated Node preserved, live and QA services unchanged.'
} finally {
    Stop-ZhixuLaunchedProcess $taskFrontend $taskRoot
    Stop-ZhixuLaunchedProcess $taskBackend $taskRoot
    # This fixture is created by this check; it is deliberately not a Zhixu service.
    if ($taskForeign -and -not $taskForeign.HasExited -and $taskForeignOrigin) {
        $taskRemaining = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskForeign.Id)"
        if ($taskRemaining -and $taskRemaining.CreationDate -eq $taskForeignOrigin.CreationDate) { Stop-Process -Id $taskForeign.Id -Force }
    }
}
