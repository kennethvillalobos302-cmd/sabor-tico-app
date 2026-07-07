@echo off
title Camaras Sabor Tico
cd /d "%~dp0"
echo ============================================
echo   ARRANCANDO EL SISTEMA DE CAMARAS...
echo ============================================

rem -- localizar Docker Desktop (instalacion normal o por-usuario)
set "DD=%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
if not exist "%DD%" set "DD=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"

rem -- arrancar Docker si no esta corriendo
docker info >nul 2>&1
if errorlevel 1 (
  echo Arrancando Docker Desktop... espera un momento
  start "" "%DD%"
  set /a INTENTOS=0
  :espera
  timeout /t 5 /nobreak >nul
  set /a INTENTOS+=1
  docker info >nul 2>&1
  if errorlevel 1 (
    if %INTENTOS% LSS 36 goto espera
    echo [X] Docker no arranco. Abre "Docker Desktop" manualmente y corre esto de nuevo.
    pause
    exit /b 1
  )
)

echo Levantando camaras, grabador, tuneles y sincronizador...
docker compose up -d
echo.
docker compose ps --format "table {{.Name}}\t{{.Status}}"
timeout /t 6 /nobreak >nul
start http://localhost:5000
echo.
echo ============================================
echo   LISTO. Camaras corriendo:
echo    - En esta compu:   localhost:5000 (vivo)
echo                       localhost:5001 (grabaciones)
echo    - En sabortico.app: seccion Camaras
echo      (aparecen solas en ~2 minutos)
echo ============================================
pause
