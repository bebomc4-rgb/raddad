@echo off
rem K FAST AI: copy the bot's data (customers, settings, products) for the backup phone.
rem The bot keeps running here. The WhatsApp session is NOT copied: the phone links WhatsApp as its own device.
set T=%TEMP%\raddad-data
if exist "%T%" rmdir /s /q "%T%"
robocopy "C:\raddad\data" "%T%" /E /XD wa-sessions backups backup-step1 backup-step2 backup-step3 backup-step4 auto-test auto-test_edited /XF *.log >nul
powershell -NoProfile -Command "Compress-Archive -Path '%T%\*' -DestinationPath (Join-Path $env:USERPROFILE 'Downloads\raddad-data.zip') -Force"
if errorlevel 1 (echo [!] Packing failed. & pause & exit /b 1)
rmdir /s /q "%T%"
if exist "C:\raddad\RUN-ON-PHONE.txt" del "C:\raddad\RUN-ON-PHONE.txt"
echo.
echo [OK] Downloads\raddad-data.zip is ready. Copy it to the phone's Download folder,
echo      then in Termux:  cd ~/raddad ^&^& git pull ^&^& bash deploy/termux-restore.sh
pause
