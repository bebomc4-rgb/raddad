@echo off
rem Raddad server - keep this window open (minimized is fine)
title Raddad - do not close
cd /d "%~dp0.."
:loop
echo [%date% %time%] Raddad starting...
node --no-warnings=ExperimentalWarning server.js >> data\server.log 2>&1
echo [%date% %time%] Raddad stopped, restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
