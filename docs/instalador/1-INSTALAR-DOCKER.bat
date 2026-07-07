@echo off
title Camaras Sabor Tico - Paso 1: instalar Docker (una sola vez)
echo ============================================================
echo   Se va a instalar Docker Desktop (el motor del sistema).
echo   Cuando Windows pregunte, toca "SI".
echo   Tarda unos minutos. Al final puede pedir REINICIAR: hazlo.
echo ============================================================
if not exist "%~dp0Docker-Desktop-Installer.exe" (
  echo Descargando el instalador oficial (~500 MB)...
  curl -L -o "%~dp0Docker-Desktop-Installer.exe" "https://desktop.docker.com/win/main/amd64/Docker%%20Desktop%%20Installer.exe"
)
"%~dp0Docker-Desktop-Installer.exe" install --quiet --accept-license --backend=wsl-2
if errorlevel 1 (
  echo.
  echo Si fallo: haz doble clic directo a Docker-Desktop-Installer.exe
  pause
  exit /b 1
)
echo.
echo Docker instalado. Si Windows pide reiniciar, REINICIA la compu.
echo Despues del reinicio: abre "Docker Desktop" una vez (acepta los
echo terminos) y luego doble clic a  2-PROBAR.bat
pause
