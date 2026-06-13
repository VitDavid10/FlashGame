@echo off
title PillWars - Tunel publico (amigos por internet)
echo ==========================================================
echo   TUNEL PUBLICO PARA AMIGOS  (requiere servidor abierto)
echo ==========================================================
echo.
echo  1. Abre antes ABRIR-SERVIDOR.bat (o ABRIR-TODO.bat)
echo  2. Espera a que aqui salga una URL  https://xxxx.trycloudflare.com
echo  3. Pasa a tus amigos este enlace (con TU url):
echo.
echo     https://pillwars.fun/game/?server=wss://xxxx.trycloudflare.com
echo.
echo  4. Tu panel de admin tambien queda publico en:
echo     https://xxxx.trycloudflare.com/admin
echo.
echo  La URL cambia cada vez que abres el tunel. No cierres esta
echo  ventana mientras jueguen.
echo ==========================================================
echo.
"%~dp0cloudflared.exe" tunnel --url http://localhost:8080
pause
