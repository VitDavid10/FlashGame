# Ficha de PillWars en la Solana dApp Store

Todo lo que pide el Publisher Portal (https://publish.solanamobile.com), en el
orden en que sale. Los textos van en inglés, como la web; se copian tal cual.

## Archivos (esta carpeta)

| Campo del portal | Archivo | Tamaño |
|---|---|---|
| Icono | `icon-512.png` | 512 × 512 |
| Banner | `banner-1200x600.png` | 1200 × 600 |
| Feature graphic (opcional; hace falta para salir en Editor's choice) | `feature-1200x1200.png` | 1200 × 1200 |
| Capturas (mínimo 4, misma orientación y proporción) | `screenshots/01-arcade.png` … `06-modos.png` | 2400 × 1080 |
| APK | `E:\android-tools\apks\PillWars-1.0.0-dappstore.apk` (no está en el repo) | versión 1.0.0, código 1 |

Orden de las capturas: 01 arcade (stick y skills), 02 classic (split y SHOOT),
03 selector de skill, 04 menú del modo, 05 pantalla de inicio, 06 rueda de modos.
Con las cinco primeras basta; la 06 es la más floja.

## Datos de la app

- **App name:** `PillWars`
- **Package name:** `fun.pillwars.app`
- **Category:** Games
- **Price:** Free (sin compras, sin anuncios, sin wallet en esta versión)
- **Privacy policy URL:** `https://pillwars.fun/privacy.html`
- **Terms / license URL:** `https://pillwars.fun/terms.html`
- **Copyright URL** (si lo pide aparte): `https://pillwars.fun/terms.html`
- **Website:** `https://pillwars.fun` en cuanto se reabra la web. Mientras
  esté apagada (SITE_CLOSED) esa dirección da 404; hasta entonces mejor
  `https://x.com/pillwarsdotfun`.
- **Contact email:** el tuyo o `contact@pillwars.fun` cuando exista (está
  pendiente). La página `https://pillwars.fun/contact.html` sí funciona.

## Short description (máx. 30 caracteres)

```
Eat, grow, outplay rival pills
```

## Long description

```
PillWars is a fast pixel-art arena game: you are a pill, you eat food and smaller rivals, and you grow until you rule the map - or get swallowed by someone bigger.

TWO WAYS TO PLAY
- ARCADE: a roguelike arena. Every 30 seconds you draft one of two skills - sprint, shield, magnet, teleport, clone, shoot, instant mass or a risky mass roll. Build your combo and climb to the top 10 before the clock runs out.
- CLASSIC: pure pill-eating. 15-minute matches: split to catch your prey, shoot to hit it from afar. Eat or be eaten.

MADE FOR YOUR PHONE
- Virtual stick in the bottom-left corner, or just tap where you want to go
- Round SPLIT and skill buttons right under your thumb
- Double-tap to split toward a point, swipe to shoot
- Plays sideways, even with rotation lock on

ONLINE OR OFFLINE
Jump into a free online room against real players, or practice offline against bots whenever you want.

No sign-up and no ads: pick a name and a color, and play.
```

## What's new (1.0.0)

```
First release on the Solana dApp Store.
```

## Testing instructions (para los revisores)

```
No account, wallet or payment is needed.
1. Tap TAP TO START.
2. Pick a mode (the arrow switches between ARCADE and CLASSIC) and tap it.
3. PLAY > PLAY OFFLINE starts a match against bots right away. PLAY > PLAY ONLINE joins the free online room; if nobody else is online you warm up against bots until someone joins.
Controls: drag in the bottom-left corner for the stick, or tap anywhere to move there. SPLIT button or double-tap to split; skill buttons next to SPLIT; swipe to shoot.
```

## Pasos en el portal

1. Registrarte en https://publish.solanamobile.com, rellenar el perfil de
   publisher y pasar la verificación (KYC/KYB).
2. Conectar la wallet de publisher (Phantom, Solflare o Backpack) con unos
   0,2 SOL. Es la definitiva: úsala siempre para esta app.
3. Elegir ArDrive como almacenamiento (lo recomendado) y recargarlo si lo pide.
4. «Add a dApp» → «New dApp»: datos y textos de arriba, icono, banner,
   feature graphic y capturas.
5. En la app, «New Version»: subir el APK y aprobar en la wallet cada firma
   (subida de archivos y NFT de la app).
6. Entra sola en revisión. Respuesta en 3-5 días laborables por correo, desde
   publishersupport@dappstore.solanamobile.com.
