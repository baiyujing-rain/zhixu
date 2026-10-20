$ErrorActionPreference = 'Stop'
# 冒烟验证：启动 zhixu-backend.exe，轮询 /api/health 返回 200，然后清理。
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$exe = Join-Path $root 'desktop\dist\backend\zhixu-backend.exe'
if (-not (Test-Path $exe)) {
    throw "后端 exe 不存在：$exe（请先运行 build-backend.ps1）"
}

# 端口已被占用时直接失败，避免健康检查误打到其它进程导致假通过。
if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
    throw '端口 8000 已被占用，请先释放后再验证'
}

# 用临时 APPDATA 做封闭验证，避免污染真实用户数据目录（backend_entry 依此定位 DB/.env）。
$tmpData = Join-Path $env:TEMP ('zhixu-verify-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmpData | Out-Null
$env:APPDATA = $tmpData

$proc = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
try {
    $ok = $false
    for ($i = 0; $i -lt 180; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/health' -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -eq 200 -and $resp.Content -match '"status"\s*:\s*"ok"') {
                $ok = $true
                break
            }
        }
        catch {
            # 服务尚未就绪，继续轮询
        }
        if ($proc.HasExited) {
            break
        }
    }

    if ($ok) {
        Write-Host 'verify-backend: PASS — /api/health 返回 200'
    }
    else {
        $log = Join-Path $tmpData 'zhixu\logs\backend.log'
        if (Test-Path $log) {
            Write-Host "--- backend.log 末尾 ---"
            Get-Content $log -Tail 30
        }
        throw 'verify-backend: FAIL — 后端未在 90s 内就绪或 /api/health 非 200'
    }
}
finally {
    if (-not $proc.HasExited) {
        # PyInstaller onefile 会派生子进程，必须结束整棵进程树。
        & taskkill /PID $proc.Id /T /F | Out-Null
    }
    Remove-Item -Recurse -Force $tmpData -ErrorAction SilentlyContinue
}
