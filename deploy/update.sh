#!/usr/bin/env bash
# Actualiza PillWars en el VPS: baja lo ultimo de GitHub y reinicia el servidor.
# Uso (como root en el VPS):   bash /home/pillwars/FlashGame/deploy/update.sh
set -e
APPDIR="/home/pillwars/FlashGame"
echo "==> Bajando ultimos cambios de GitHub..."
sudo -u pillwars git -C "$APPDIR" pull
echo "==> Instalando dependencias (por si cambiaron)..."
( cd "$APPDIR" && sudo -u pillwars npm install --omit=dev )
echo "==> Reiniciando el servidor..."
systemctl restart pillwars
sleep 2
systemctl --no-pager status pillwars | head -n 5
echo ""
echo "==> Listo. Cambios aplicados en https://pillwars.fun"
