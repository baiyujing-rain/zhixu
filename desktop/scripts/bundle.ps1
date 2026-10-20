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
npx tauri build --config (Join-Path $root 'desktop\src-tauri\tauri.conf.json')
if ($LASTEXITCODE -ne 0) { throw 'Tauri 构建失败' }

Write-Host "==> 完成。安装包位于 desktop\src-tauri\target\release\bundle\nsis\"
