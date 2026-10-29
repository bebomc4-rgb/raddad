@echo off
chcp 65001 >nul
echo === Installing Claude Code plugins ===
"%APPDATA%\Python\Python312\Scripts\graphify.exe" install
call claude plugin marketplace add getagentseal/codeburn
call claude plugin install codeburn@codeburn
call claude plugin marketplace add DietrichGebert/ponytail
call claude plugin install ponytail@ponytail
setx PATH "%PATH%;%APPDATA%\Python\Python312\Scripts" >nul
echo.
echo [OK] Done. Close Claude Code and open it again.
pause
