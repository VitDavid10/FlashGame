# Boceto del menú de la app (EN PAUSA, sin decidir)

Rediseño del menú principal de la app (hub) con el estilo de la pantalla VS y de VICTORY.
**Estado: en pausa. David aún no ha elegido variante. No aplicar nada al juego hasta que lo decida.**

## Lo que hay
- `menu-B1.jpg`, `menu-B2.jpg`, `menu-B3.jpg`: fondo lima con cuadrícula (le gustó el fondo "B"),
  franja negra inclinada arriba, losas negras inclinadas a la izquierda (THE PILL / ARENAS / STORE / QUESTS)
  y PLAY negro con letras lima. Cambia dónde va ARCADE · FREE:
  - B1: pestaña negra "ARCADE FREE ⇄" encima de PLAY.
  - B2: "ARCADE · FREE" dentro del botón PLAY, botón ⇄ aparte y GROUP con texto (la que recomendé).
  - B3: dos chips encima de PLAY ("ARCADE ⇄" negro, "FREE" verde).
  B1 y B3 aún llevan los iconos viejos (emojis); B2 ya lleva los pixel.
- `iconos.jpg`: iconos pixel 16x16 (arenas, store, quests, amigos, grupo, música, atrás, cambiar modo).
- `pix-icons.js`: genera esos iconos por código (`pwPixIcon(nombre, acento, acentoOscuro)` devuelve un canvas 16x16;
  el contorno negro sale solo). Para retocar un icono, editar su función en `dib`.
- `menu-mock.js`: monta el boceto encima del juego (`_mk('lime', 1|2|3)`; 'dark' = la variante A de fondo oscuro).

## Lo que pidió David y falta decidir
- Los iconos tienen que parecer pixel art de verdad (nada de emojis); los de amigos y grupo distintos.
- Iconos dentro de cada losa un poco más abajo, para que se vea la franja oscura encima (hecho en B2).
- Iconos de arriba (amigos, música, atrás) más grandes y separados; GROUP separado de PLAY.
- Elegir cómo va ARCADE · FREE (B1/B2/B3).

## Cómo verlo
1. Copiar `menu-mock.js` y `pix-icons.js` a `game/` (con otro nombre, p. ej. `zz-*.js`, y NO commitearlos ahí).
2. Arrancar el servidor local y abrir `/game/index.html?app` en 1000x450.
3. En la consola: cargar los dos scripts con `<script src>` (la CSP no deja `eval`), ocultar `#loadingScreen`
   y llamar `_mk('lime', 2)`.
   `menu-mock.js` empieza por `window._mk = (function (variante, abajo) {`.
4. Al terminar, borrar los `zz-*.js` de `game/`.

Al aplicar el diseño elegido, borrar esta carpeta (las comparativas se borran en el commit que aplica el cambio).
