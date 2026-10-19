$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'service-helpers.ps1')
$taskRoot = 'D:\Zcodex_project1'
$taskCases = @(
    @{ Name='node.exe'; Command='"C:\Program Files\nodejs\node.exe" "D:\Zcodex_project1\node_modules\next\dist\bin\next" start --hostname 127.0.0.1'; Expected=$true },
    @{ Name='node.exe'; Command='node.exe "D:\Zcodex_project1\node_modules\next\dist\bin\next" dev'; Expected=$true },
    @{ Name='node.exe'; Command='node.exe other.js --data "D:\Zcodex_project1\node_modules\next\dist\bin\next" start'; Expected=$false },
    @{ Name='node.exe'; Command='node.exe "D:\Zcodex_project1\node_modules\next\dist\bin\next-other.js" start'; Expected=$false },
    @{ Name='node.exe'; Command='node.exe "D:\other-project\node_modules\next\dist\bin\next" start'; Expected=$false },
    @{ Name='node.exe'; Command='node.exe "D:\Zcodex_project1\node_modules\next\dist\bin\next" build'; Expected=$false },
    @{ Name='python.exe'; Command='"D:\Zcodex_project1\.venv\Scripts\python.exe" -m uvicorn backend.main:app --host 127.0.0.1'; Expected=$true },
    @{ Name='python.exe'; Command='"D:\Zcodex_project1\.venv\Scripts\python.exe" -B -m uvicorn backend.main:app --app-dir "D:\Zcodex_project1"'; Expected=$true },
    @{ Name='python.exe'; Command='"D:\Zcodex_project1\.venv\Scripts\python.exe" other.py --data "-m uvicorn backend.main:app"'; Expected=$false },
    @{ Name='python.exe'; Command='"D:\other-project\.venv\Scripts\python.exe" -m uvicorn backend.main:app'; Expected=$false },
    @{ Name='python.exe'; Command='"D:\Zcodex_project1\.venv\Scripts\python.exe" -m uvicorn backend.other:app'; Expected=$false },
    @{ Name='python.exe'; Command='"D:\Zcodex_project1\.venv\Scripts\python.exe" -m uvicorn backend.main:app --app-dir "D:\other-project"'; Expected=$false },
    @{ Name='powershell.exe'; Command='powershell.exe -Command "D:\Zcodex_project1\node_modules\next\dist\bin\next" start'; Expected=$false }
)
foreach ($taskCase in $taskCases) {
    $taskResult = Test-ZhixuServiceProcess ([pscustomobject]@{Name=$taskCase.Name; CommandLine=$taskCase.Command}) $taskRoot
    if ($taskResult -ne $taskCase.Expected) { throw "Ownership validation failed: $($taskCase.Command)" }
}
$taskSpacedRoot = 'D:\Algorithm Projects\Zhixu'
$taskSpaced = [pscustomobject]@{Name='node.exe'; CommandLine='"C:\Program Files\nodejs\node.exe" "D:\Algorithm Projects\Zhixu\node_modules\next\dist\bin\next" start'}
if (-not (Test-ZhixuServiceProcess $taskSpaced $taskSpacedRoot)) { throw 'Paths with spaces were not recognized.' }
Write-Host "$($taskCases.Count + 1) ownership cases passed. No service was stopped."
