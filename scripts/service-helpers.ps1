function Get-ZhixuCommandArguments {
    param([string]$CommandLine)
    if (-not ('Zhixu.CommandArguments' -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace Zhixu {
    public static class CommandArguments {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CommandLineToArgvW(string command, out int count);
        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr pointer);
        public static string[] Parse(string command) {
            if (String.IsNullOrWhiteSpace(command)) return new string[0];
            int count;
            IntPtr pointer = CommandLineToArgvW(command, out count);
            if (pointer == IntPtr.Zero) return new string[0];
            try {
                string[] values = new string[count];
                for (int i = 0; i < count; ++i) values[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer, i * IntPtr.Size));
                return values;
            } finally { LocalFree(pointer); }
        }
    }
}
"@
    }
    return [Zhixu.CommandArguments]::Parse($CommandLine)
}

function Test-ZhixuServiceProcess {
    param($ProcessInfo, [string]$ProjectRoot)
    if (-not $ProcessInfo -or -not $ProcessInfo.CommandLine) { return $false }
    $taskNextPath = Join-Path $ProjectRoot 'node_modules\next\dist\bin\next'
    $taskPythonPath = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
    $taskArguments = @(Get-ZhixuCommandArguments $ProcessInfo.CommandLine)
    if ($ProcessInfo.Name -ieq 'node.exe') {
        return $taskArguments.Count -ge 3 -and $taskArguments[1].Replace('/','\').Equals($taskNextPath, [StringComparison]::OrdinalIgnoreCase) -and $taskArguments[2] -in @('start','dev')
    }
    if ($ProcessInfo.Name -ine 'python.exe' -or $taskArguments.Count -lt 4 -or -not $taskArguments[0].Replace('/','\').Equals($taskPythonPath, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    $taskModuleIndex = 1
    while ($taskModuleIndex -lt $taskArguments.Count -and $taskArguments[$taskModuleIndex] -in @('-B','-u')) { $taskModuleIndex++ }
    if ($taskArguments.Count -le $taskModuleIndex + 2 -or $taskArguments[$taskModuleIndex] -cne '-m' -or $taskArguments[$taskModuleIndex + 1] -cne 'uvicorn' -or $taskArguments[$taskModuleIndex + 2] -cne 'backend.main:app') { return $false }
    $taskAppIndex = [Array]::IndexOf($taskArguments, '--app-dir')
    if ($taskAppIndex -ge 0) {
        return $taskArguments.Count -gt $taskAppIndex + 1 -and $taskArguments[$taskAppIndex + 1].Replace('/','\').TrimEnd('\').Equals($ProjectRoot.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
    }
    # Recognize legacy launchers from this project's private Python environment.
    return $true
}

function Get-ZhixuPortOwners {
    param([string]$ProjectRoot)
    $taskConnections = @(Get-NetTCPConnection -LocalPort 3000,8000 -State Listen -ErrorAction SilentlyContinue)
    foreach ($taskConnection in $taskConnections) {
        $taskProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskConnection.OwningProcess)"
        if (-not $taskProcessInfo) { continue }
        [pscustomobject]@{ Port = $taskConnection.LocalPort; ProcessId = $taskProcessInfo.ProcessId; CreationDate = $taskProcessInfo.CreationDate; Owned = (Test-ZhixuServiceProcess $taskProcessInfo $ProjectRoot) }
    }
}

function Stop-ZhixuServices {
    param([string]$ProjectRoot)
    $taskOwners = @(Get-ZhixuPortOwners $ProjectRoot)
    # Preflight all ports before stopping anything. Other apps are preserved.
    foreach ($taskOwner in $taskOwners) {
        if (-not $taskOwner.Owned) { throw "Port $($taskOwner.Port) belongs to another application (PID $($taskOwner.ProcessId)). Zhixu did not stop it." }
    }
    foreach ($taskOwner in $taskOwners) {
        $taskProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskOwner.ProcessId)"
        if (-not $taskProcessInfo) { continue }
        if ($taskProcessInfo.CreationDate -ne $taskOwner.CreationDate -or -not (Test-ZhixuServiceProcess $taskProcessInfo $ProjectRoot)) { throw 'The service process changed during restart. Retry the launcher.' }
        $taskRootInfo = $taskProcessInfo
        for ($taskAncestor = 0; $taskAncestor -lt 4; $taskAncestor++) {
            $taskParentInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskRootInfo.ParentProcessId)"
            if (-not (Test-ZhixuServiceProcess $taskParentInfo $ProjectRoot) -or $taskParentInfo.CreationDate -gt $taskRootInfo.CreationDate) { break }
            $taskRootInfo = $taskParentInfo
        }
        $taskVerified = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskRootInfo.ProcessId)"
        if ($taskVerified -and $taskVerified.CreationDate -eq $taskRootInfo.CreationDate -and (Test-ZhixuServiceProcess $taskVerified $ProjectRoot)) {
            Write-Host "Stopping previous Zhixu service on port $($taskOwner.Port)..."
            Stop-ZhixuVerifiedProcessTree $taskRootInfo $ProjectRoot
        }
    }
    for ($taskWait = 0; $taskWait -lt 15; $taskWait++) {
        if (-not @(Get-ZhixuPortOwners $ProjectRoot).Count) { return }
        Start-Sleep -Milliseconds 500
    }
    throw 'Previous services have not released their ports. Retry in a few seconds.'
}

function Open-ZhixuLauncherLock {
    param([string]$LockPath)
    try { return [System.IO.File]::Open($LockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None) }
    catch [System.IO.IOException] { return $null }
}

function Stop-ZhixuLaunchedProcess {
    param($Process, [string]$ProjectRoot)
    if (-not $Process -or $Process.HasExited) { return }
    $taskInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($Process.Id)"
    if ($taskInfo -and (Test-ZhixuServiceProcess $taskInfo $ProjectRoot)) { Stop-ZhixuVerifiedProcessTree $taskInfo $ProjectRoot }
}

function Stop-ZhixuVerifiedProcessTree {
    param($ProcessInfo, [string]$ProjectRoot)
    $taskCurrent = Get-CimInstance Win32_Process -Filter "ProcessId = $($ProcessInfo.ProcessId)"
    if (-not $taskCurrent) { return }
    if ($taskCurrent.CreationDate -ne $ProcessInfo.CreationDate -or -not (Test-ZhixuServiceProcess $taskCurrent $ProjectRoot)) { throw 'The service process changed before stopping. Retry the launcher.' }
    # Windows can report an already-exited child as stderr even after it stopped
    # the service. Collect native output, then check the verified process itself.
    $taskOldPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $taskKillOutput = & taskkill.exe /PID $taskCurrent.ProcessId /T /F 2>&1
        $taskKillExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $taskOldPreference }
    for ($taskWait = 0; $taskWait -lt 10; $taskWait++) {
        $taskRemaining = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskCurrent.ProcessId)"
        if (-not $taskRemaining -or $taskRemaining.CreationDate -ne $taskCurrent.CreationDate) { return }
        Start-Sleep -Milliseconds 200
    }
    throw "Could not stop Zhixu service PID $($taskCurrent.ProcessId) (taskkill exit $taskKillExit). No unrelated process was stopped."
}
