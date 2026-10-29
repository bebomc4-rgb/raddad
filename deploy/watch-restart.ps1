# K FAST AI: any change in the code restarts the server by itself (windows-start.bat brings it back up in 3 seconds)
# so nobody has to run RESTART-ALL after an update. Started hidden by START-ALL.vbs.
$root = 'C:\raddad'
$w = New-Object IO.FileSystemWatcher $root, '*.js'
$w.IncludeSubdirectories = $true
$w.NotifyFilter = [IO.NotifyFilters]'LastWrite, FileName'
Register-ObjectEvent $w Changed -SourceIdentifier kfChanged | Out-Null
Register-ObjectEvent $w Created -SourceIdentifier kfCreated | Out-Null
Register-ObjectEvent $w Renamed -SourceIdentifier kfRenamed | Out-Null
$w.EnableRaisingEvents = $true
$last = Get-Date; $pending = $false
while ($true) {
  $e = Wait-Event -Timeout 2
  if ($e) {
    $p = [string]$e.SourceEventArgs.FullPath
    Remove-Event -EventIdentifier $e.EventIdentifier
    if ($p -match '\\(node_modules|data|\.git|\.claude|messenger-draft-extension|tools|bin)\\') { continue }
    $pending = $true; $last = Get-Date; continue
  }
  # wait until the files stop changing for 3 seconds (an update writes several files), then restart once
  if ($pending -and ((Get-Date) - $last).TotalSeconds -ge 3) {
    $pending = $false
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server\.js' -and $_.CommandLine -notmatch 'claude' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    try { Add-Content -Path "$root\data\server.log" -Value "[$(Get-Date -Format s)] code changed - server restarting by itself" } catch {}
  }
}
