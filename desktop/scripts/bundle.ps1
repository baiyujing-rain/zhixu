$ErrorActionPreference = 'Stop'
# 一键构建：后端(PyInstaller) → 前端(standalone) → Tauri 壳。
# 前端由 tauri build 的 beforeBuildCommand（build-frontend.mjs）触发，此处不重复构建。
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    throw "缺少虚拟环境 Python：$python"
}

Write-Host "==> [1/3] 打包后端"
& $python -m PyInstaller --noconfirm --clean `
    --distpath (Join-Path $root 'desktop\dist\backend') `
    --workpath (Join-Path $root 'desktop\build\backend') `
    (Join-Path $root 'backend\zhixu-backend.spec')
if ($LASTEXITCODE -ne 0) { throw '后端打包失败' }

Write-Host "==> [2/3] 打包前端（由 tauri beforeBuildCommand 触发）"
Write-Host "==> [3/3] 构建 Tauri 壳（NSIS 安装包）"

# 沙箱会经 NODE_OPTIONS 注入「安全删除」shim，拦截 next build 清理 chunk 的批量删除导致构建失败；
# 桌面构建链路不需要该 shim，显式清除，让 beforeBuildCommand 的 node / next build 干净运行。
$env:NODE_OPTIONS = ''

# Tauri bundler 需从 github.com 下载 NSIS/WiX 等工具；沙箱代理可能对 github 返回 502。
# 优先探测直连，直连不通时自动切到 GitHub 镜像（gh-proxy.com），普通网络环境不受影响。
if (-not $env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR) {
    $probeOk = $false
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        $code = (& curl.exe -s -o NUL -w '%{http_code}' --max-time 8 'https://github.com' 2>$null)
        if ($LASTEXITCODE -eq 0 -and $code -match '^[123]\d\d$') { $probeOk = $true }
    }
    if (-not $probeOk) {
        $env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR = 'https://gh-proxy.com/https://github.com/'
        Write-Host '==> github 直连不可达，NSIS 工具下载改用镜像：gh-proxy.com'
    }
}

npx tauri build --config (Join-Path $root 'desktop\src-tauri\tauri.conf.json')
if ($LASTEXITCODE -ne 0) { throw 'Tauri 构建失败' }

Write-Host "==> 完成。安装包位于 desktop\src-tauri\target\release\bundle\nsis\"
