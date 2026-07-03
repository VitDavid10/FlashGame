# Plan: texture pack pixel art

Objetivo: que el juego (web principal, /game y la partida) pueda verse en pixel art
**sin tocar físicas ni red**. La simulación vive en `shared/sim.js` + servidor; el
render es un lector del estado. Todo el trabajo de este plan es cliente puro
(`game/index.html`, `index.html`, `img/`). El servidor no se toca.

## Estado

- [x] **F0 — Modo retro instantáneo** — DESCARTADA tras probarla: bajar la resolución
  del frame entero se ve "a mala resolución", no pixel art. Se sustituyó por F2.
- [~] **F1 — Paleta, fuente pixel y UI** — PARCIAL: (a) los menús de /game (login,
  modales, leaderboard, oracle, misiones, botones, inputs, slots) tienen relieve
  pixel art vía `body.pixel-pack` (bordes duros + sombra escalonada, mismos
  colores). (b) Fuente **bitmap pixel 5×7 procedural** (`PIXFONT` + `drawPixelText`
  + `pixTextCanvas`, contorno 8-dir y sombra diagonal arcade) aplicada a: GO!
  splash, número de cuenta atrás, textos flotantes (world + UI) y overlay de
  skills (título "SELECT A SKILL" + nombres de skill). (c) Versión "premium"
  multicapa (`pixFancyText`: bold 11×15, sombreado interno, tinta + halo verde +
  placa oscura + sparkles) y marco 9-slice con brackets (`ensurePixPanelCss`,
  border-image) para la skill-choice-card, timer bar y botones. Falta: landing
  (`index.html`), aplicar el marco bracket a más paneles (modales, leaderboard),
  y los PNG del usuario (logo PILLWARS splash, iconos de skills) que se enchufan
  tal cual, sin recortes.
- [x] **F2 — Sprites del mundo** — HECHA en versión procedural: pills, comida,
  virus, proyectiles y masa eyectada se dibujan desde sprites pixel generados en
  código (contorno + sombreado + brillo), escalados sin suavizado a resolución
  completa. Los PNG de ChatGPT quedan como mejora opcional que se enchufa en los
  mismos puntos.
- [x] **F3 — Fondo y borde del mapa** — HECHA: tile 100×100 cacheado por tema
  (`pixBgPattern`, base + moteado sutil + grid grueso 4px) sustituye al grid de
  líneas; el borde ya tenía versión pixel sin glow. Extra: virus con giro
  cuantizado (16 pasos, fase/sentido por virus, más lento cuanto más grande) y
  más detalle en los grandes (más dientes, anillo interior, núcleo, highlight).
- [~] **F4 — Animaciones y efectos** — explosión, partículas y textos con versión
  pixel; **escudo/inmunidad** rehecho: `pixShieldSprite` (heater pixel cacheado,
  emblema de cruz) orbitando en pasos, upright (sin aliasing) y más rápido que las
  4 badges vectoriales de antes. Faltan imán/sprint refinados.
- [ ] **F5 — Texture pack seleccionable definitivo + QA** (el toggle ya activa todo)

## Puntos de anclaje en el código

Todo el dibujo del mundo está concentrado en `game/index.html`:

| Qué | Dónde | Nota |
|---|---|---|
| Pill del jugador | `drawCell()` | Ya clipa una imagen dentro de la pill (sistema de skins, `skinCache`/`getSkinImage`) → el pipeline de sprites ya existe |
| Colores de pill | `drawCellColors()` | Los 2 colores (top/bot) son **dinámicos por jugador** |
| Comida, virus, proyectiles, grid, borde | `draw()` | Formas procedurales canvas 2D |
| Masa eyectada | `drawMiniPill()` | Con LOD: círculo plano si `sR < DRAW_LOD_THRESHOLD` |
| Explosiones | `class Explosion` | Partículas procedurales |
| Textos flotantes | `FloatingText` / `FixedUIText` | Fuente Russo One sobre canvas |
| Temas | `setTheme()` | Variables CSS `--bg-color` / `--grid-line` |
| Calidad | `setQuality()` | Ya condiciona el dibujo (high/normal/low/ultra) |
| Modo pixel | `setPixelMode()` / `drawCellPixel()` / `pixPillSprite()` / `pixDotSprite()` / `pixVirusSprite()` | `localStorage.pw_pixel`; píxel gordo `PIX_SCREEN_PX = 4`; caches en `PIX.*` |

## F0 — Modo retro instantáneo ❌ (descartada)

Se probó bajar el backbuffer a 1/3 y reescalar con `image-rendering: pixelated`.
Veredicto: se ve como el juego "a mala resolución", no como pixel art. Lección:
**pixel art premium = pantalla nítida a resolución completa + sprites deliberados
con pocos píxeles** (estilo Celeste/Dead Cells), no downscale global. El toggle y
la persistencia (`pw_pixel`) se conservaron; el render se reemplazó por F2.

## F1 — Paleta, fuente pixel y UI

- Paleta limitada (16–32 colores) partiendo de los colores actuales:
  `#9EE32D`/`#3E8E11` (virus/proyectil), `#a020f0` (inmunidad), `#FFD700` (sprint),
  `#ccff00` (acentos UI), `#1a73e8` (online).
- Fuente pixel de Google Fonts (candidatas: *Press Start 2P*, *VT323*, *Silkscreen*)
  reemplazando Russo One cuando el pack pixel está activo (clase `body.pixel-pack`
  + variable CSS `--font-main`, así el toggle también cambia la UI).
- `index.html` (landing) y menús de `/game`: bordes duros (sin `border-radius`),
  sombras sólidas (`box-shadow: 4px 4px 0 #000`) en vez de blur, botones pixel.
- Iconos de `img/` (big, clon, iman, inmune, random, shoot, split1/2, sprint, tp,
  virus1/2…): convertir con ChatGPT. **Specs para que salgan consistentes**:
  - 64×64 px, PNG con fondo transparente
  - paleta fija (pasarle la lista de colores elegida en el prompt)
  - sin antialiasing, sin degradados, borde exterior 1px oscuro
  - mismo prompt base para todos, cambiando solo el sujeto

## F2 — Sprites del mundo ✅ (versión procedural)

Implementado sin assets externos: cada sprite se genera pixel a pixel en un canvas
offscreen a resolución lógica baja y se escala sin suavizado
(`ctx.imageSmoothingEnabled = false` en `resize()`), con el píxel gordo a
~`PIX_SCREEN_PX` (4px) constante en pantalla — un objeto grande tiene más píxeles
de detalle que uno pequeño, como en pixel art real.

- **Pills** (`pixPillSprite`): cápsula con contorno oscuro 1px lógico, banda de
  sombra abajo-derecha, banda de luz arriba-izquierda, costura entre mitades y
  highlight. Cache por `tamaño|colorTop|colorBot` (colores dinámicos por jugador,
  cap 400 entradas). Las skins por URL siguen funcionando (se pixelan solas al
  escalarse sin suavizado).
- **Comida/proyectiles** (`pixDotSprite`): blob redondo con contorno y sombra
  diagonal; a tamaños mínimos queda como cruz/rombo pixel. Cache por color.
- **Virus** (`pixVirusSprite`): rueda dentada de 12 dientes, 3 tonos + manchas;
  estado dañado con lerp verde→morado cuantizado a pasos de 0.25.
- **Masa eyectada**: mismo `pixPillSprite` pequeño, rotado con `f.angle`.
- LOD: los buckets de tamaño hacen de LOD natural (mínimo 4px lógicos).

Mejora opcional futura: sustituir los generadores por PNG dibujados a mano/ChatGPT
en los MISMOS puntos (las funciones `pix*Sprite` devuelven un canvas; basta
devolver una imagen del atlas).

## F3 — Fondo y borde del mapa

- Grid de líneas cada 100px → tile pixel de 100×100 dibujado en canvas offscreen a
  partir de `--bg-color`/`--grid-line` (así los 3 temas siguen funcionando) y
  pintado con `createPattern` + un solo `fillRect` del viewport.
- Borde del mapa: hoy es rect rojo con `shadowBlur` + dash animado → muro de
  "bloques" (rects de N px alternando 2 tonos de rojo, offset animado con el mismo
  `dashOffset`).

## F4 — Animaciones y efectos

Regla general: **fuera `shadowBlur`** en modo pixel (es lo más caro del render
actual; quitarlo sube FPS) y opacidades en escalones (`Math.round(a*4)/4`).

- Explosión (`class Explosion`): sprite sheet 6–8 frames.
- Partículas BOLT/PLUS/MINUS de `drawCell`: sprites de 8×8 o texto con la fuente pixel.
- Escudo de inmunidad (roundRect morado + 4 escudos orbitando): anillo de bloques +
  sprite de escudo 16×16 orbitando en pasos discretos de ángulo.
- Ondas de imán y sprint glow: anillos con grosor entero y alpha en escalones.
- `FloatingText`/`FixedUIText`: con F0 ya salen pixelados; en F1 pasan a fuente pixel.

## F5 — Pack definitivo + QA

- El toggle de F0 pasa a activar TODO el pack (backbuffer + sprites + fuente + CSS).
- Fallback garantizado: si el atlas no carga, render procedural actual.
- QA: FPS en móvil (el render es el cuello del cliente, no la red), los 3 temas,
  calidades high/normal/low/ultra combinadas con pixel on/off.

## Assets a generar (ChatGPT / a mano)

| Asset | Tamaño | Quién |
|---|---|---|
| Iconos skills (los de `img/`) | 64×64 | ChatGPT (specs en F1) |
| Comida ×2–3 variantes | 16×16 | ChatGPT |
| Virus normal + dañado | 64×64 | ChatGPT |
| Proyectil / masa eyectada | 16×16 | ChatGPT |
| Explosión sprite sheet | 6–8 frames de 32×32 | ChatGPT |
| Pill base escala de grises | 64×128 | a mano/código (control del tintado) |
| Tile de fondo | 100×100 | código (offscreen, respeta temas) |
| Fuente pixel | — | Google Fonts (gratis) |
