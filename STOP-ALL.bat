@echo off
echo Stopping K FAST AI...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'watch-restart\.ps1|windows-start\.bat|image-ai-start\.bat|raddad.*server\.js|server\.js|ComfyUI\\main\.py|llama-server|cloudflared' -and $_.CommandLine -notmatch 'claude|Get-CimInstance' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo [OK] Stopped.
timeout /t 2 >nul
