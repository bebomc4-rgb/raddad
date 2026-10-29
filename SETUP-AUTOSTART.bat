@echo off
chcp 65001 >nul
set SU=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
echo Cleaning old startup items...
del /q "%SU%\*raddad*" 2>nul
del /q "%SU%\*Raddad*" 2>nul
del /q "%SU%\*llama*" 2>nul
del /q "%SU%\*image-ai*" 2>nul
copy /y "%~dp0START-ALL.vbs" "%SU%\K-FAST-AI.vbs" >nul
echo Closing visible windows and restarting hidden...
call "%~dp0STOP-ALL.bat"
timeout /t 3 >nul
wscript "%~dp0START-ALL.vbs"
echo.
echo [OK] Done. From now on everything starts hidden with Windows.
echo      STATUS.bat = see what's running, RESTART-ALL.bat = restart, STOP-ALL.bat = stop
pause
