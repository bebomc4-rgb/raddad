@echo off
chcp 65001 >nul
echo === K FAST AI status ===
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -notmatch 'Get-CimInstance' }; function s($n,$re){ if ($p | Where-Object { $_.CommandLine -match $re }) { Write-Host ('[ON ] ' + $n) -ForegroundColor Green } else { Write-Host ('[OFF] ' + $n) -ForegroundColor Red } }; s 'Platform (WhatsApp agent)' 'server\.js'; s 'Local AI (llama-server)' 'llama-server'; s 'Image AI (ComfyUI)' 'ComfyUI\\main\.py'"
echo.
pause
