@echo off
title Camaras Sabor Tico - Arreglar WSL (una sola vez)
echo ============================================================
echo   Se va a instalar/actualizar WSL (el motor que Docker usa).
echo   Ejecutar este archivo con CLIC DERECHO -^> "Ejecutar como
echo   administrador". Tarda unos minutos.
echo ============================================================
wsl --install --no-distribution --web-download
echo.
echo ============================================================
echo   Cuando termine: REINICIA la computadora.
echo   Despues del reinicio: abre "Docker Desktop" y espera a que
echo   la ballena quede fija (Engine running). Luego 2-PROBAR.bat
echo ============================================================
pause
