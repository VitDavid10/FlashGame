@echo off
REM PillWars Stress Bot - arranca el panel local
REM Doble click para usar. Instala deps si no existen, luego abre el navegador.

cd /d "%~dp0"

if not exist node_modules (
    echo Instalando dependencias por primera vez...
    call npm install
    if errorlevel 1 (
        echo.
        echo ERROR: npm install fallo. Necesitas Node.js instalado: https://nodejs.org/
        pause
        exit /b 1
    )
)

echo.
echo Arrancando panel en http://localhost:7777
echo Cierra esta ventana para detener el panel.
echo.
node server.js
pause
