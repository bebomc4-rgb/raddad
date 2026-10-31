# K FAST AI: every 5 minutes, if there is a new version on GitHub (main), take it.
# watch-restart.ps1 then restarts the server by itself. The data folder is never touched (it is not in git).
$root = 'C:\raddad'
Set-Location $root
$log = "$root\data\update.log"
Set-Content -Path "$root\data\update-loop.pid" -Value $PID
while ($true) {
  Start-Sleep -Seconds 300
  try {
    git fetch -q origin main 2>> $log
    if ($LASTEXITCODE -ne 0) { continue }
    $cur = (git rev-parse HEAD).Trim(); $new = (git rev-parse origin/main).Trim()
    if ($cur -eq $new) { continue }
    $oldPkg = (git rev-parse "HEAD:package.json" 2>$null)
    git checkout -q -B main origin/main 2>> $log
    git reset -q --hard origin/main 2>> $log
    if ((git rev-parse "HEAD:package.json").Trim() -ne $oldPkg) { cmd /c "npm install --omit=dev --no-audit --no-fund >> data\update.log 2>&1" }
    Add-Content -Path $log -Value "[$(Get-Date -Format s)] updated to $(git log -1 --format='%h %s')"
  } catch { Add-Content -Path $log -Value "[$(Get-Date -Format s)] update failed: $_" }
}
