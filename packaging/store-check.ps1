# Exercise the same entry point as a double click, after extracting the release ZIP.
param([Parameter(Mandatory)][string]$Executable)
$ErrorActionPreference = 'Stop'
$env:PEAKCUT_DATA = Join-Path $env:RUNNER_TEMP 'endrox-release-check'
$env:PEAKCUT_FETCH_MODEL = '0'
$exe = (Resolve-Path $Executable).Path
$app = Start-Process -FilePath $exe -PassThru
try {
    $deadline = (Get-Date).AddMinutes(2)
    do {
        if ($app.HasExited) { throw "Endrox exited before showing sign-in ($($app.ExitCode))." }
        $edge = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' AND ParentProcessId=$($app.Id)" |
            Where-Object CommandLine -Match '--app=http://127\.0\.0\.1:\d+/app/media' | Select-Object -First 1
        if ($edge) {
            $window = Get-Process -Id $edge.ProcessId -ErrorAction SilentlyContinue
            if ($window.MainWindowTitle -match 'Sign in to Endrox') {
                Write-Host "The released executable opened the Endrox sign-in window."
                break
            }
        }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    if (!$window -or $window.MainWindowTitle -notmatch 'Sign in to Endrox') {
        throw 'The released app did not display its sign-in page within two minutes.'
    }
} finally {
    if (!$app.HasExited) { taskkill /PID $app.Id /T /F | Out-Null }
}
$test = Start-Process -FilePath $exe -ArgumentList '--self-test' -PassThru
if (!$test.WaitForExit(180000)) {
    taskkill /PID $test.Id /T /F | Out-Null
    throw 'The release self-test timed out.'
}
if ($test.ExitCode -ne 0) { throw "The release self-test failed ($($test.ExitCode))." }
