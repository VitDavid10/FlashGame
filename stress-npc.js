#!/usr/bin/env node
/**
 * Stress test "realista" para PillWars.
 * - Reparte los bots entre TODAS las salas (classic/arcade × Free/5$/10$/20$/50$).
 * - Cada bot vaga como un NPC: elige un punto del mapa y se dirige hacia él;
 *   al llegar (o cada cierto tiempo) elige otro destino. Nada de saltos random.
 *
 * Uso:
 *   node stress-npc.js [opciones]
 *
 * Opciones (variables de entorno):
 *   SERVER=ws://localhost:8080   URL del servidor
 *   BOTS=300                     Total de conexiones a abrir
 *   RAMP_MS=60                   Milisegundos entre cada conexión nueva
 *   INPUT_HZ=10                  Inputs por segundo por bot (10 = 1 cada 100ms)
 *   DURATION_S=60                Segundos que dura el test (0 = indefinido)
 *   MODES=classic,arcade         Modos a usar
 *   PRICES=Free,5$,10$,20$,50$   Precios a usar
 *   ROOMS=classic_Free,arcade_5$ Salas exactas (mode_room) — anula MODES/PRICES
 *   STRESS_JSON=1                Emite líneas "STATS {json}" en vez del informe bonito
 */

'use strict';

const WebSocket = require('ws');
const { genBotName } = require('./shared/botnames');

const SERVER     = process.env.SERVER     || 'ws://localhost:8080';
const BOTS       = parseInt(process.env.BOTS      || '300', 10);
const RAMP_MS    = parseInt(process.env.RAMP_MS   || '60',  10);
const INPUT_HZ   = parseInt(process.env.INPUT_HZ  || '10',  10);
const DURATION_S = parseInt(process.env.DURATION_S || '60', 10);
const MODES      = (process.env.MODES  || 'classic,arcade').split(',');
const PRICES     = (process.env.PRICES || 'Free,5$,10$,20$,50$').split(',');
const JSON_MODE  = process.env.STRESS_JSON === '1';
// Respawn: al morir un bot, reconecta tras un retardo aleatorio para que la sala
// no se vacíe (mantiene la población ~constante, pero sin reentrar todos a la vez).
const RESPAWN    = process.env.RESPAWN !== '0';
const RESPAWN_MIN = parseInt(process.env.RESPAWN_MIN_MS || '2000', 10);
const RESPAWN_MAX = parseInt(process.env.RESPAWN_MAX_MS || '6000', 10);
let testOver = false;   // se activa al acabar la duración: deja de reconectar

const INPUT_INTERVAL = Math.max(33, Math.round(1000 / INPUT_HZ));

// Catálogo de salas. Si se pasa ROOMS (lista exacta "mode_room") se usa esa;
// si no, se construye con MODES × PRICES. Los bots se reparten en round-robin.
const ROOMS = [];
if (process.env.ROOMS) {
  for (const k of process.env.ROOMS.split(',').map(s => s.trim()).filter(Boolean)) {
    const i = k.indexOf('_');
    if (i > 0) ROOMS.push({ mode: k.slice(0, i), room: k.slice(i + 1) });
  }
}
if (!ROOMS.length) { for (const m of MODES) for (const p of PRICES) ROOMS.push({ mode: m, room: p }); }

const stats = {
  connected: 0, disconnected: 0, errors: 0,
  entered: 0, rejected: 0, wins: 0,   // entraron / rechazados (llena) / ganaron (5 kills classic)
  messagesSent: 0, messagesReceived: 0,
  latencies: [],
  porSala: {},   // "mode_room" → dentro de la sala
};
ROOMS.forEach(r => stats.porSala[r.mode + '_' + r.room] = 0);

function randColor() { return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); }
function avgLatency() { return stats.latencies.length ? Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length) : 0; }

function spawnBot(i) {
  const dest = ROOMS[i % ROOMS.length];   // reparto equitativo entre todas las salas
  const salaKey = dest.mode + '_' + dest.room;

  let ws;
  try { ws = new WebSocket(SERVER); } catch { stats.errors++; return; }

  let inputTimer = null, pingTimer = null;
  let mapSize = 4000;            // se actualiza con el welcome del servidor
  let tx = 0, ty = 0;            // objetivo actual (coordenadas del mundo)
  let counted = false;
  let myId = null;               // id del jugador en la sim (para detectar mi muerte)
  let reconnectPending = false;

  // Elige un nuevo destino dentro del mapa (a veces hacia el centro para no pegarse al borde)
  function nuevoDestino() {
    const lim = mapSize * 0.9;
    if (Math.random() < 0.15) { tx = (Math.random() - 0.5) * mapSize * 0.4; ty = (Math.random() - 0.5) * mapSize * 0.4; }
    else { tx = (Math.random() * 2 - 1) * lim; ty = (Math.random() * 2 - 1) * lim; }
  }
  nuevoDestino();

  ws.on('open', () => {
    stats.connected++;
    ws.send(JSON.stringify({ t: 'join', mode: dest.mode, room: dest.room, name: genBotName(), colorBot: randColor(), colorTop: randColor(), tester: 'STRESS_TEST_DEVNET' }));
    stats.messagesSent++;

    // Movimiento tipo NPC: dirigirse al destino; al acercarse, elegir otro.
    inputTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (Math.random() < 0.04) nuevoDestino();   // de vez en cuando cambia de rumbo
      ws.send(JSON.stringify({ t: 'input', tx, ty }));
      stats.messagesSent++;
    }, INPUT_INTERVAL);

    pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ t: 'ping', ts: Date.now() })); stats.messagesSent++;
    }, 3000);
  });

  ws.on('message', (data) => {
    stats.messagesReceived++;
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'roomFull') { stats.rejected++; try { ws.close(); } catch {} return; }
    if (m.t === 'pong') { if (m.ts) { stats.latencies.push(Date.now() - m.ts); if (stats.latencies.length > 200) stats.latencies.shift(); } return; }
    if (m.id) myId = m.id;   // welcome / matchStart traen mi id
    if (m.t === 'welcome' && !counted) { stats.entered++; stats.porSala[salaKey]++; counted = true; }
    if (m.mapSize) mapSize = m.mapSize;   // el welcome trae el tamaño real del mapa
    // Salir y reponer cuando MUERO o GANO (en classic, a 5 kills se gana y el
    // jugador real se desconecta). Reconectamos como nuevo para que la sala cicle
    // igual que con jugadores reales, en vez de quedarnos inmunes ocupando plaza.
    if (m.t === 'events' && Array.isArray(m.events) && myId && !reconnectPending) {
      for (const ev of m.events) {
        const muerto = ev.type === 'playerDied' && ev.playerId === myId;
        const gano = ev.type === 'botKilled' && ev.playerId === myId && ev.mode === 'classic' && ev.streak >= 5;
        if (muerto || gano) {
          if (gano) stats.wins++;
          if (RESPAWN && !testOver) {
            reconnectPending = true;
            const delay = RESPAWN_MIN + Math.random() * Math.max(0, RESPAWN_MAX - RESPAWN_MIN);
            setTimeout(() => { if (!testOver) spawnBot(i); }, delay);
          }
          try { ws.close(); } catch {}
          break;
        }
      }
    }
  });

  ws.on('close', () => {
    stats.disconnected++;
    if (counted) { stats.porSala[salaKey]--; counted = false; }
    clearInterval(inputTimer); clearInterval(pingTimer);
  });

  ws.on('error', () => { stats.errors++; });
}

// Snapshot de estadísticas para el modo JSON (lo parsea el servidor/panel)
let _cpu = process.cpuUsage(), _cpuT = Date.now();
function cpuPct() {
  const u = process.cpuUsage(_cpu); const dt = Date.now() - _cpuT;
  _cpu = process.cpuUsage(); _cpuT = Date.now();
  return dt > 0 ? Math.round((u.user + u.system) / 1000 / dt * 100) : 0;
}
function snapshotStats(done) {
  return {
    bots: BOTS, launched, active: stats.connected - stats.disconnected,
    entered: stats.entered, rejected: stats.rejected, wins: stats.wins, errors: stats.errors,
    sent: stats.messagesSent, received: stats.messagesReceived,
    latency: avgLatency(), porSala: stats.porSala, cpu: cpuPct(), done: !!done,
  };
}
function emitJson(done) { process.stdout.write('STATS ' + JSON.stringify(snapshotStats(done)) + '\n'); }

if (!JSON_MODE) {
  console.log(`\nPillWars Stress Test (movimiento NPC)`);
  console.log(`Servidor : ${SERVER}`);
  console.log(`Bots     : ${BOTS}  repartidos entre ${ROOMS.length} salas`);
  console.log(`Salas    : ${ROOMS.map(r => r.mode + '_' + r.room).join(', ')}`);
  console.log(`Inputs   : ${INPUT_HZ} Hz por bot   Ramp: ${RAMP_MS}ms`);
  console.log(`Duración : ${DURATION_S ? DURATION_S + 's' : 'indefinido'}`);
  console.log('─'.repeat(60));
}

let launched = 0;
const rampTimer = setInterval(() => {
  if (launched >= BOTS) { clearInterval(rampTimer); return; }
  spawnBot(launched); launched++;
}, RAMP_MS);

const reportTimer = setInterval(() => {
  if (JSON_MODE) { emitJson(false); return; }
  const active = stats.connected - stats.disconnected;
  const dist = ROOMS.map(r => { const k = r.mode + '_' + r.room; return `${r.room[0]}${r.mode[0]}:${stats.porSala[k]}`; }).join(' ');
  process.stdout.write(`\r⚡ ${active}/${BOTS} act  ✓${stats.entered} dentro  ✗${stats.rejected} llenas  ↑${stats.messagesSent} ↓${stats.messagesReceived}  ⚠${stats.errors}  ~${avgLatency()}ms  [${dist}]   `);
}, JSON_MODE ? 1000 : 2000);

if (DURATION_S > 0) {
  setTimeout(() => {
    testOver = true;
    clearInterval(rampTimer); clearInterval(reportTimer);
    if (JSON_MODE) { emitJson(true); process.exit(0); }
    const active = stats.connected - stats.disconnected;
    console.log('\n\n' + '─'.repeat(60));
    console.log('RESULTADOS FINALES');
    console.log(`  Conexiones abiertas    : ${stats.connected}`);
    console.log(`  Entraron a jugar       : ${stats.entered}`);
    console.log(`  Rechazados (sala llena): ${stats.rejected}`);
    console.log(`  Desconexiones          : ${stats.disconnected}`);
    console.log(`  Activos al finalizar   : ${active}`);
    console.log(`  Errores de conexión    : ${stats.errors}`);
    console.log(`  Mensajes enviados      : ${stats.messagesSent}`);
    console.log(`  Mensajes recibidos     : ${stats.messagesReceived}`);
    console.log(`  Latencia media (ping)  : ${avgLatency()}ms`);
    console.log('  Distribución por sala  :');
    ROOMS.forEach(r => { const k = r.mode + '_' + r.room; console.log(`    ${k.padEnd(16)} ${stats.porSala[k]}`); });
    console.log('─'.repeat(60));
    process.exit(0);
  }, DURATION_S * 1000);
}
