#!/usr/bin/env node
/**
 * Vuelca a un fichero VERSIONADO el diseño que está vivo en el servidor.
 *
 * El layout del hero y del menú no se edita en el repo: se mueve a mano desde
 * EDIT LAYOUT en la propia web y se guarda en server/globalsettings.json, que
 * está en .gitignore. Resultado: el diseño visual entero vive sin historial en
 * una sola máquina. Este script lo saca por las APIs públicas (no hace falta
 * entrar al VPS) y lo deja en design-layout.json para poder commitearlo,
 * comparar versiones y volver atrás si una edición sale mal.
 *
 * Se guardan SOLO las tres claves de diseño. El resto de globalsettings.json
 * (volúmenes, arcadeRestartMs, layoutEdit...) es estado de ejecución y
 * ensuciaría el historial con un commit por cada slider que muevas.
 *
 * Uso:
 *   node scripts/dump-design-layout.js                    # producción
 *   node scripts/dump-design-layout.js http://localhost:8080
 *   npm run design:dump
 *
 * La dirección va SIEMPRE del servidor al repo. Nunca al revés: si un deploy
 * copiara este fichero al VPS, se llevaría por delante las ediciones en vivo.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BASE = (process.argv[2] || 'https://pillwars.fun').replace(/\/+$/, '');
const OUT = path.join(__dirname, '..', 'design-layout.json');

if (typeof fetch !== 'function') {
  console.error('Este script necesita Node 18 o superior (fetch global).');
  process.exit(1);
}

async function get(ruta) {
  const res = await fetch(BASE + ruta, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`${ruta} → HTTP ${res.status}`);
  return res.json();
}

// Claves ordenadas al serializar: el servidor las devuelve en el orden en que
// se tocaron, así que sin esto cada volcado sale como un fichero entero nuevo
// en el diff aunque no haya cambiado ni un valor.
function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = ordenar(v[k]); return acc; }, {});
  }
  return v;
}

// Compara dos layouts y devuelve qué elementos entran, salen o cambian, para
// que el volcado diga en una línea si hay algo nuevo antes de commitear.
function comparar(antes, ahora) {
  const a = antes || {}, b = ahora || {};
  const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
  const nuevos = [], borrados = [], cambiados = [];
  for (const k of claves) {
    if (!(k in a)) nuevos.push(k);
    else if (!(k in b)) borrados.push(k);
    else if (JSON.stringify(ordenar(a[k])) !== JSON.stringify(ordenar(b[k]))) cambiados.push(k);
  }
  return { nuevos, borrados, cambiados };
}

(async () => {
  console.log(`Leyendo diseño de ${BASE} ...`);

  let landing, rooms, carteles;
  try {
    // menuLayout no tiene GET propio (/api/menu-layout es POST): viaja dentro
    // de /api/rooms, que es lo que consulta el menú del juego al arrancar.
    [landing, rooms, carteles] = await Promise.all([
      get('/api/landing-layout'),
      get('/api/rooms'),
      get('/api/carteles-layout'),
    ]);
  } catch (e) {
    console.error(`No se pudo leer el servidor: ${e.message}`);
    process.exit(1);
  }

  const nuevo = {
    landingLayout: ordenar(landing.layout || {}),
    menuLayout: ordenar(rooms.menuLayout || {}),
    cartelesLayout: ordenar(carteles || {}),
  };

  const previo = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;

  for (const clave of ['landingLayout', 'menuLayout', 'cartelesLayout']) {
    const n = Object.keys(nuevo[clave]).length;
    if (!previo) { console.log(`  ${clave}: ${n} elementos`); continue; }
    const d = comparar(previo[clave], nuevo[clave]);
    const notas = [
      d.nuevos.length && `+${d.nuevos.length} (${d.nuevos.join(', ')})`,
      d.cambiados.length && `~${d.cambiados.length} (${d.cambiados.join(', ')})`,
      d.borrados.length && `-${d.borrados.length} (${d.borrados.join(', ')})`,
    ].filter(Boolean);
    console.log(`  ${clave}: ${n} elementos${notas.length ? ' — ' + notas.join('  ') : ' — sin cambios'}`);
  }

  fs.writeFileSync(OUT, JSON.stringify(nuevo, null, 2) + '\n', 'utf8');
  console.log(`\nEscrito ${path.relative(process.cwd(), OUT)}`);
  console.log('Si te convence, commitea el fichero para dejarlo en el historial.');
})();
