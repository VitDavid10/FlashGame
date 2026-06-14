# Desplegar PillWars en un VPS (Hetzner + Ubuntu 24.04)

Guía paso a paso. Arquitectura final:

```
Jugador ──HTTPS/wss──> Caddy (:443, certificado automático) ──> Node (localhost:8080)
                                                                    sirve web + juego + admin + partidas
```

Todo bajo **pillwars.fun**, sin Cloudflare ni túnel. El dominio se apunta al VPS
con un registro A en Porkbun.

---

## 1. Conectar al VPS

Desde tu PC (PowerShell o terminal), con la IP que te dio Hetzner:

```
ssh root@LA_IP_DEL_VPS
```

(La primera vez acepta la huella con `yes`. Si usas contraseña, es la del email de Hetzner.)

## 2. Preparar el sistema

```bash
apt update && apt upgrade -y
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git
# Usuario sin privilegios para el juego
adduser --disabled-password --gecos "" pillwars
```

## 3. Clonar el repo y instalar

```bash
su - pillwars
git clone https://github.com/davidpedret/FlashGame.git
cd FlashGame
npm install --omit=dev
exit   # volver a root
```

## 4. Servicio que corre 24/7 (systemd)

```bash
cp /home/pillwars/FlashGame/deploy/pillwars.service /etc/systemd/system/
# EDITA la clave de admin (cambia 1234 por una larga y secreta):
nano /etc/systemd/system/pillwars.service     # línea ADMIN_KEY=...
systemctl daemon-reload
systemctl enable --now pillwars
systemctl status pillwars     # debe salir "active (running)"
```

Comprobación local en el VPS:

```bash
curl -I http://localhost:8080/game/     # debe dar 200
```

## 5. Apuntar el dominio (en Porkbun)

En el panel de Porkbun → DNS de **pillwars.fun**:

- **Borra** los registros que apuntaban a GitHub Pages (los `A` de GitHub y el `CNAME` de www).
- **Añade**:
  - Tipo `A`,  Host vacío (o `@`),  Valor = **IP del VPS**
  - Tipo `A`,  Host `www`,        Valor = **IP del VPS**

Espera unos minutos a que propague (puedes comprobar en https://www.whatsmydns.net/#A/pillwars.fun
hasta ver la IP del VPS).

## 6. HTTPS automático con Caddy

```bash
# Instalar Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Configuración (proxy a Node con HTTPS y wss automáticos)
cp /home/pillwars/FlashGame/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddy pedirá el certificado solo. En ~30 s, **https://pillwars.fun** estará vivo
con el juego, y el WebSocket irá por **wss://pillwars.fun** automáticamente
(el cliente ya usa wss cuando la página es https).

## 7. Panel de control

`https://pillwars.fun/admin` — con la clave que pusiste en `ADMIN_KEY`.

---

## Actualizar el juego más adelante

Cuando cambiemos código y hagamos push a GitHub:

```bash
su - pillwars
cd FlashGame && git pull && npm install --omit=dev
exit
systemctl restart pillwars
```

(La web/juego son archivos estáticos: con el `git pull` ya quedan servidos; el
restart es por si cambió el servidor.)

## Cosas útiles

- Logs del servidor:   `journalctl -u pillwars -f`
- Reiniciar servidor:  `systemctl restart pillwars`
- Estado de Caddy:     `systemctl status caddy`
- Firewall (opcional): `ufw allow 22,80,443/tcp && ufw enable`
