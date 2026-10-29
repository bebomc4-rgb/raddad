@echo off
rem Update Raddad from the newest raddad*.zip in your Downloads folder (your data stays safe)
echo === Updating Raddad from Downloads ===
powershell -NoProfile -ExecutionPolicy Bypass -Command "$z = Get-ChildItem \"$env:USERPROFILE\Downloads\raddad*.zip\" | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if (-not $z) { Write-Host '[X] No raddad.zip found in Downloads'; exit 1 }; Write-Host ('Using ' + $z.Name + '  (' + $z.LastWriteTime + ')'); $t = Join-Path $env:TEMP 'raddad-new'; if (Test-Path $t) { Remove-Item -Recurse -Force $t }; Expand-Archive -Force $z.FullName $t; robocopy (Join-Path $t 'raddad') 'C:\raddad' /E /XD data node_modules /NFL /NDL /NJH /NJS /NP | Out-Null; Remove-Item -Recurse -Force $t; Write-Host '[OK] Files updated'"
if errorlevel 1 (
  pause
  exit /b 1
)
call "C:\raddad\deploy\windows-update.bat"
