param([switch]$NoBrowser, [switch]$Restart)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
. (Join-Path $PSScriptRoot 'service-helpers.ps1')
$taskLogs = Join-Path $taskRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $taskLogs | Out-Null
$taskLockPath = Join-Path $taskLogs 'launcher.lock'
$taskLock = Open-ZhixuLauncherLock $taskLockPath
if (-not $taskLock -and -not $Restart) {
    $taskOtherOwners = @(Get-ZhixuPortOwners $taskRoot | Where-Object { -not $_.Owned })
    if ($taskOtherOwners.Count) { throw 'A Zhixu launcher is active, but its ports are occupied by another application.' }
    Write-Host 'Zhixu is already running or preparing. Opening the existing app.' -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:3000' }
    exit 0
}
if (-not $taskLock) {
    Stop-ZhixuServices $taskRoot
    for ($taskLockAttempt = 0; $taskLockAttempt -lt 20 -and -not $taskLock; $taskLockAttempt++) {
        Start-Sleep -Milliseconds 500
        $taskLock = Open-ZhixuLauncherLock $taskLockPath
    }
    if (-not $taskLock) { throw 'Another launcher is still preparing Zhixu. Wait for it to finish before restarting.' }
}
try {
Stop-ZhixuServices $taskRoot
$taskPython = Join-Path $taskRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules\next'))) {
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
}
$taskPreviousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $taskPython (Join-Path $PSScriptRoot 'check-dependencies.py')
$taskDependencyExit = $LASTEXITCODE
$ErrorActionPreference = $taskPreviousPreference
if ($taskDependencyExit -ne 0) {
    & $taskPython -m pip install -r backend\requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
    & $taskPython (Join-Path $PSScriptRoot 'check-dependencies.py')
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependencies do not match the tested set.' }
}
node scripts\copy-monaco.mjs
if ($LASTEXITCODE -ne 0) { throw 'Editor resource preparation failed.' }
Write-Host 'Preparing the production application...'
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
if (@(Get-ZhixuPortOwners $taskRoot).Count) { throw 'A port was occupied while preparing the application. Retry the launcher.' }
$taskBackend = $null
$taskFrontend = $null
try {
    $taskAppDir = '"' + $taskRoot + '"'
    $taskBackend = Start-Process -FilePath $taskPython -ArgumentList @('-m', 'uvicorn', 'backend.main:app', '--app-dir', $taskAppDir, '--host', '127.0.0.1', '--port', '8000', '--no-access-log') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogs 'backend.log') -RedirectStandardError (Join-Path $taskLogs 'backend-error.log')
    $taskNode = (Get-Command node).Source
    $taskNext = '"' + (Join-Path $taskRoot 'node_modules\next\dist\bin\next') + '"'
    $taskFrontend = Start-Process -FilePath $taskNode -ArgumentList @($taskNext, 'start', '--hostname', '127.0.0.1') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogs 'frontend.log') -RedirectStandardError (Join-Path $taskLogs 'frontend-error.log')
    Write-Host 'Starting Zhixu... logs are in artifacts/.'
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 90; $taskAttempt++) {
        if ($taskBackend.HasExited -or $taskFrontend.HasExited) { throw 'A service exited. Check artifacts/*-error.log.' }
        try {
            $taskResponse = Invoke-WebRequest 'http://127.0.0.1:3000/api/health' -UseBasicParsing -TimeoutSec 2
            if ($taskResponse.StatusCode -eq 200) { $taskReady = $true; break }
        } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $taskReady) { throw 'Startup timed out. Check the log files.' }
    Write-Host 'Ready: http://127.0.0.1:3000  |  Ctrl+C stops both services.' -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:3000' }
    while (-not $taskBackend.HasExited -and -not $taskFrontend.HasExited) { Start-Sleep -Seconds 1 }
    $taskExited = if ($taskBackend.HasExited) { "backend (exit $($taskBackend.ExitCode))" } else { "frontend (exit $($taskFrontend.ExitCode))" }
    throw "Zhixu $taskExited stopped unexpectedly. Check artifacts/*-error.log."
} finally {
    Stop-ZhixuLaunchedProcess $taskBackend $taskRoot
    Stop-ZhixuLaunchedProcess $taskFrontend $taskRoot
}
} finally {
    if ($taskLock) { $taskLock.Dispose() }
}
