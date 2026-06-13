@echo off
rem Arranca todo de golpe: servidor + web + abre el juego en el navegador
cd /d "%~dp0"
echo Arrancando servidor del juego...
start "PillWars - SERVIDOR" cmd /k "cd /d "%~dp0" && node server\index.js"
echo Arrancando web...
start "PillWars - WEB" cmd /k "cd /d "%~dp0" && npx -y http-server -p 8123 -c-1 ."
echo Esperando 4 segundos para abrir el juego...
timeout /t 4 /nobreak >nul
start http://localhost:8123/game/
exit
