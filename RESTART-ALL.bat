@echo off
call "%~dp0STOP-ALL.bat"
timeout /t 3 >nul
wscript "%~dp0START-ALL.vbs"
echo [OK] Restarted (running hidden). Open http://localhost:3000
timeout /t 3 >nul
