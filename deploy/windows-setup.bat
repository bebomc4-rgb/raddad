@echo off
rem Raddad - Windows setup: double-click this file
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%PATH%;%ProgramFiles%\nodejs"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [X] Node.js is not installed. Install it from https://nodejs.org then run this again.
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%PATH%;%ProgramFiles%\Git\cmd"
where git >nul 2>nul
if errorlevel 1 if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Git\cmd"
where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo [X] Git is not installed. Install it from https://git-scm.com/download/win then run this again.
  pause
  exit /b 1
)

echo.
echo === Installing Raddad (takes 1-3 minutes) ===
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo [X] Install failed. Take a screenshot of this window.
  pause
  exit /b 1
)

if not exist .env copy .env.example .env >nul
if not exist data mkdir data

echo.
echo === Keeping the PC awake when plugged in ===
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

echo.
echo === Auto-start with Windows ===
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\raddad.bat" echo @echo off
>> "%STARTUP%\raddad.bat" echo start "Raddad" /min "%CD%\deploy\windows-start.bat"

echo.
echo === Starting Raddad ===
start "Raddad" /min "%CD%\deploy\windows-start.bat"
timeout /t 4 /nobreak >nul
start "" http://localhost:3000

echo.
echo [OK] Raddad is running at http://localhost:3000
echo      It will start automatically every time Windows starts.
echo      A minimized window called "Raddad" must stay open.
pause
