# Handoff: sesión de Claude Code en la nube → local (9-oct-2026)

Todo el trabajo está en GitHub, en `main` y en `claude/gracious-cray-n70rjd`. No hay nada pendiente solo en la nube.

## Normas que pidió David
- Todo lo que ve el jugador, en **inglés**. Hablar con David en español.
- Cada cambio: commit, `git push origin HEAD:main` (y la rama de trabajo). Sin pull requests salvo que los pida.
- En el VPS se actualiza con `bash /home/pillwars/FlashGame/deploy/update.sh` y luego Ctrl+Shift+R.
- Verificar con capturas antes de decir que algo está hecho, y decir qué no se ha probado.

## Dónde está cada cosa
- Menú nuevo (hub): `game/app-hub.js` (HTML, CSS y JS en el mismo archivo). PC = `#appHub.pc`.
- PILLWARS CORE (solo PC): pestañas WATCH, CORE, BASICS, MODES, SKILLS. Busca `CORE_VIDEOS`, `CORE_IMGS` y `renderCore` en `game/app-hub.js`.
- WATCH espera `video/social/1.mp4`, `2.mp4`, `4.mp4` y `5.mp4` (el 3, GAME MODES, aún no existe y sale como SOON). Si falta un archivo, su tarjeta no sale.
- Imágenes de la pestaña CORE: `game/img/core/agar.png` y `game/img/core/basics.png`.
- Claim del airdrop (solo devnet, 10K $PILLY al saldo del juego): `/api/airdrop-claim` en `server/index.js`; sale como fila AIRDROP en CLAIM.
- Ajustes que viajan con la cuenta (nombre, colores, skills de salida, apodos, avisos, foto, misiones, rejoin): `server/accountsync.js` + `cuentaSync()` en `game/app-hub.js`.

## Pendiente
- Subir los vídeos de WATCH (`video/social/1,2,4,5.mp4`). En la raíz no sirven: `.gitignore` ignora `/*.mp4`.
- Clips nuevos de SPLIT, VIRUS, COMBAT y de cada skill: se intentó grabarlos automáticamente con Playwright (partida offline, dar masa, apuntar, dividir...) y aún no salen presentables (cámara muy alejada, saltos al recolocar). Siguen los vídeos originales.
- Dudas abiertas con David: si PILLWARS CORE debe estar también en móvil.
- Sin confirmar: SP posiblemente duplicados entre dos wallets con el mismo X (pedir el contenido de `server/skinpoints.json`, claves `w_...` y `x_...`).
