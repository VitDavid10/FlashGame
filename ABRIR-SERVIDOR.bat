@echo off
title PillWars - SERVIDOR (no cerrar mientras se juega)
cd /d "%~dp0"
echo ============================================
echo   PillWars - SERVIDOR DEL JUEGO
echo   ws://localhost:8080  -  Admin: /admin
echo   Cierra esta ventana para apagar el servidor
echo ============================================
echo.
node server\index.js
echo.
echo El servidor se ha detenido.
pause
