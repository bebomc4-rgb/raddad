@echo off
rem K FAST AI: move the bot to the phone. Stops it here for good (two copies would fight over WhatsApp)
rem and packs its data (WhatsApp session, customers, settings) into Downloads\raddad-data.zip
echo Stopping the bot on this PC...
call "%~dp0STOP-ALL.bat"
echo on phone> "%~dp0RUN-ON-PHONE.txt"
echo Packing the data...
powershell -NoProfile -Command "Compress-Archive -Path 'C:\raddad\data\*' -DestinationPath (Join-Path $env:USERPROFILE 'Downloads\raddad-data.zip') -Force"
if errorlevel 1 (echo [!] Packing failed. & pause & exit /b 1)
echo.
echo [OK] Done: Downloads\raddad-data.zip
echo      Copy it to the phone's Download folder, then run the setup in Termux.
echo      The bot will NOT start on this PC any more (delete RUN-ON-PHONE.txt to undo).
pause
