@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo OS Protegida - Projeto Integrado UNIFEOB
echo.
node --version
if errorlevel 1 (
  echo Node.js nao encontrado. Instale Node.js 22.16.0 ou superior.
  pause
  exit /b 1
)
echo.
npm start
pause
