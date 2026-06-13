@echo off
title PillWars - WEB (no cerrar mientras se juega)
cd /d "%~dp0"
echo ============================================
echo   PillWars - SERVIDOR WEB (la pagina del juego)
echo   http://localhost:8123/game/
echo   Cierra esta ventana para apagar la web
echo ============================================
echo.
call npx -y http-server -p 8123 -c-1 .
pause
