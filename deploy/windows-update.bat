@echo off
rem Run this after extracting a new raddad.zip over the old folder (your data stays safe)
cd /d "%~dp0.."
taskkill /fi "WINDOWTITLE eq Raddad - do not close*" /t /f >nul 2>nul
call npm install --omit=dev --no-audit --no-fund
start "Raddad" /min "%CD%\deploy\windows-start.bat"
echo [OK] Updated and restarted.
pause
