# Plan: texture pack pixel art

Objetivo: que el juego (web principal, /game y la partida) pueda verse en pixel art
**sin tocar físicas ni red**. La simulación vive en `shared/sim.js` + servidor; el
render es un lector del estado. Todo el trabajo de este plan es cliente puro
(`game/index.html`, `index.html`, `img/`). El servidor no se toca.

## Estado

- [x] **F0 — Modo retro instantáneo** (hecho, commit de esta fase)
- [ ] **F1 — Paleta, fuente pixel y UI** (web principal + menús /game)
- [ ] **F2 — Sprites del mundo** (pills, comida, virus, proyectiles)
- [ ] **F3 — Fondo y borde del mapa**
- [ ] **F4 — Animaciones y efectos**
- [ ] **F5 — Texture pack seleccionable definitivo + QA**

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
| Modo pixel (F0) | `setPixelMode()` / `pixScale()` / `resize()` | `localStorage.pw_pixel`, factor `PIXEL_FACTOR = 3` |

## F0 — Modo retro instantáneo ✅

Backbuffer a `1/PIXEL_FACTOR` de resolución en `resize()`; el CSS del canvas
(`width:100%; height:100%`) lo reescala solo, con `image-rendering: pixelated` +
`ctx.imageSmoothingEnabled = false`. El ratón se divide por `pixScale()` en los 4
puntos de captura (mousemove/touchmove/touchstart/mousedown de espectador) para que
la conversión pantalla→mundo (que compara contra `width/height` del backbuffer) siga
cuadrando. El aspect que se manda al server (`width/height`) no cambia de ratio.

Toggle "Texture Pack: Classic/Pixel" bajo Map Theme, persistido en `pw_pixel`.

Sirve para **decidir la escala de píxel** antes de encargar sprites: probar
`PIXEL_FACTOR` 2/3/4 y elegir. Con 1920×1080 y factor 3 → backbuffer 640×360.

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

## F2 — Sprites del mundo

- **Atlas**: un `game/textures.png` + JSON de coordenadas; carga con `Image` y
  `drawImage(atlas, sx, sy, sw, sh, …)`. Nada de un fichero por sprite.
- **Pills**: sprite base en **escala de grises** (no lo puede generar ChatGPT con
  colores porque top/bot son dinámicos). Tintado: canvas offscreen, dibujar el
  sprite gris, `globalCompositeOperation = 'multiply'` con los 2 colores por
  mitades, cachear por par de colores (mismo patrón que `skinCache`). Enganchar en
  `drawCell()` donde ya se clipa la skin.
- **Comida**: sprite 16×16, 2–3 variantes (ya tiene `f.c1` de color → tintado igual
  que pills o variantes precoloreadas con la paleta).
- **Virus**: 64×64, estado normal + dañado (hoy hace lerp verde→morado con
  `v.animTime`; con sprites, 2–3 frames).
- **Proyectiles y masa eyectada**: 16×16. Mantener el LOD actual (círculo plano por
  debajo del umbral) — con backbuffer reducido apenas se nota y ahorra draw calls.

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
