#!/usr/bin/env bash
# Despliegue automatico de PillWars en Ubuntu (Hetzner). Ejecutar como root:
#   curl -fsSL https://raw.githubusercontent.com/davidpedret/FlashGame/main/deploy/setup.sh | bash
#
# Instala Node + Caddy, clona el repo, deja el servidor 24/7 (systemd) y el
# HTTPS automatico. Al final imprime la clave de admin y los pasos del DNS.
set -e

DOMAIN="pillwars.fun"
REPO="https://github.com/davidpedret/FlashGame.git"
APPDIR="/home/pillwars/FlashGame"
export DEBIAN_FRONTEND=noninteractive

echo "==> [1/6] Actualizando el sistema (puede tardar 1-2 min)..."
apt-get update -y && apt-get upgrade -y

echo "==> [2/6] Instalando Node.js 20, git y Caddy..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git debian-keyring debian-archive-keyring apt-transport-https openssl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
apt-get update -y && apt-get install -y caddy

echo "==> [3/6] Usuario y descarga del juego..."
id pillwars &>/dev/null || adduser --disabled-password --gecos "" pillwars
if [ -d "$APPDIR/.git" ]; then
  sudo -u pillwars git -C "$APPDIR" pull
else
  sudo -u pillwars git clone "$REPO" "$APPDIR"
fi
( cd "$APPDIR" && sudo -u pillwars npm install --omit=dev )

echo "==> [4/6] Clave de admin..."
ADMIN_KEY=$(openssl rand -hex 16)

echo "==> [5/6] Servicio 24/7 (systemd)..."
cat >/etc/systemd/system/pillwars.service <<EOF
[Unit]
Description=PillWars game server
After=network.target

[Service]
Type=simple
User=pillwars
WorkingDirectory=$APPDIR
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
Environment=PORT=8080
Environment=ADMIN_KEY=$ADMIN_KEY
Environment=MIN_PLAYERS=5
Environment=TARGET_POP=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable pillwars >/dev/null 2>&1 || true
systemctl restart pillwars

echo "==> [6/6] HTTPS con Caddy..."
cp "$APPDIR/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl restart caddy

IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || echo "LA_IP_DEL_VPS")
echo ""
echo "============================================================"
echo "  LISTO. Servidor PillWars desplegado y corriendo."
echo "============================================================"
echo ""
echo "  >>> CLAVE DE ADMIN (apuntala bien):  $ADMIN_KEY"
echo ""
echo "  ULTIMO PASO - apuntar el dominio en Porkbun (DNS de $DOMAIN):"
echo "    - Borra los registros A de GitHub Pages y el CNAME de www"
echo "    - Anade:  Tipo A   Host (vacio o @)   Valor  $IP"
echo "    - Anade:  Tipo A   Host  www          Valor  $IP"
echo ""
echo "  En unos minutos (cuando el DNS propague):"
echo "    Juego:  https://$DOMAIN/game/"
echo "    Admin:  https://$DOMAIN/admin   (clave de arriba)"
echo "============================================================"
