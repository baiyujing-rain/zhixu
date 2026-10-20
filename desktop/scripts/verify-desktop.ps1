$ErrorActionPreference = 'Stop'
# 端到端验证（无需 Rust）：资源完整性 + 模拟 sidecar 拉起后端/前端 + 经 3000 的 /api/health + 清理。
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$backendExe = Join-Path $root 'desktop\dist\backend\zhixu-backend.exe'
$frontDir = Join-Path $root 'desktop\dist\frontend'
$serverJs = Join-Path $frontDir 'server.js'

if (-not (Test-Path $backendExe)) { throw "缺少后端产物：$backendExe（先跑 build-backend.ps1）" }
if (-not (Test-Path $serverJs)) { throw "缺少前端 server.js：$serverJs（先跑 build-frontend.mjs）" }
if (-not (Test-Path (Join-Path $frontDir '.next\static'))) { throw '缺少 .next\static' }
if (-not (Test-Path (Join-Path $frontDir 'public'))) { throw '缺少 public' }

# 端口已被占用时直接失败，避免健康检查误打到其它进程导致假通过。
foreach ($port in 3000, 8000) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "端口 $port 已被占用，请先释放后再验证"
    }
}

# 封闭数据目录
$tmpData = Join-Path $env:TEMP ('zhixu-e2e-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmpData | Out-Null
$env:APPDATA = $tmpData

# 前端 sidecar 运行环境
$env:HOSTNAME = '127.0.0.1'
$env:PORT = '3000'
$env:NODE_ENV = 'production'

# 与 sidecar.rs 一致：优先使用捆绑的 node.exe，缺失时回退 PATH 的 node。
$nodeExe = Join-Path $frontDir 'node.exe'
if (-not (Test-Path $nodeExe)) { $nodeExe = 'node' }

$backend = $null
$frontend = $null
try {
    $backend = Start-Process -FilePath $backendExe -PassThru -WindowStyle Hidden
    $frontend = Start-Process -FilePath $nodeExe -ArgumentList 'server.js' `
        -WorkingDirectory $frontDir -PassThru -WindowStyle Hidden

    $ok = $false
    for ($i = 0; $i -lt 180; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -eq 200 -and $resp.Content -match '"status"\s*:\s*"ok"') {
                $ok = $true
                break
            }
        }
        catch { }
        if ($backend.HasExited -or $frontend.HasExited) { break }
    }

    if ($ok) {
        Write-Host 'verify-desktop: PASS — 前端(3000) → rewrite → 后端(8000) 全链路 /api/health=200'
    }
    else {
        Write-Host '--- backend.log ---'
        $bl = Join-Path $tmpData 'zhixu\logs\backend.log'
        if (Test-Path $bl) { Get-Content $bl -Tail 30 }
        Write-Host '--- frontend.log ---'
        $fl = Join-Path $tmpData 'zhixu\logs\frontend.log'
        if (Test-Path $fl) { Get-Content $fl -Tail 30 }
        throw 'verify-desktop: FAIL — 全链路未在 90s 内就绪'
    }
}
finally {
    # Windows：结束整个进程树，避免残留 node 子进程
    if ($frontend -and -not $frontend.HasExited) {
        & taskkill /PID $frontend.Id /T /F | Out-Null
    }
    if ($backend -and -not $backend.HasExited) {
        & taskkill /PID $backend.Id /T /F | Out-Null
    }
    Remove-Item -Recurse -Force $tmpData -ErrorAction SilentlyContinue
}
