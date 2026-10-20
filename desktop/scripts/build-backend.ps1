$ErrorActionPreference = 'Stop'
# 仓库根（desktop/scripts -> desktop -> 仓库根）
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    throw "缺少虚拟环境 Python：$python（请先创建 .venv 并安装依赖）"
}

$dist = Join-Path $root 'desktop\dist\backend'
$work = Join-Path $root 'desktop\build\backend'
$spec = Join-Path $root 'backend\zhixu-backend.spec'

Write-Host "==> PyInstaller 打包后端（onefile, console=False）"
& $python -m PyInstaller --noconfirm --clean --distpath $dist --workpath $work $spec
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller 打包失败（退出码 $LASTEXITCODE）"
}

$exe = Join-Path $dist 'zhixu-backend.exe'
if (-not (Test-Path $exe)) {
    throw "打包完成但未找到产物：$exe"
}
Write-Host "==> 后端产物就绪：$exe"
