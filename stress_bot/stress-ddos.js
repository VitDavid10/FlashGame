#!/usr/bin/env node
/**
 * Test de DDoS / flood para PillWars.
 * Abre N conexiones "atacantes" que envían mensajes a un ritmo objetivo (total
 * repartido entre ellas) para comprobar que el rate-limit del servidor aguanta:
 * descarta el exceso y cierra las conexiones que floodean (umbral duro), dejando
 * un registro en el log de seguridad.
 *
 * Además mantiene un "canario": una conexión que juega normal y mide su ping
 * durante el ataque. Si el canario sigue con ping bajo, el servidor está protegido.
 *
 * Uso (variables de entorno):
 *   SERVER=ws://localhost:8080   URL del servidor
 *   RATE=1000                    Mensajes/segundo TOTAL del ataque
 *   CONNS=10                     Conexiones atacantes (el ritmo se reparte)
 *   DURATION_S=20                Duración del test
 *   STRESS_JSON=1                Emite líneas "STATS {json}" (lo usa el panel)
 */

'use strict';

const WebSocket = require('ws');

const SERVER     = process.env.SERVER     || 'ws://localhost:8080';
const RATE       = parseInt(process.env.RATE      || '1000', 10);
const CONNS      = parseInt(process.env.CONNS     || '10',   10);
const DURATION_S = parseInt(process.env.DURATION_S || '20',  10);
const JSON_MODE  = process.env.STRESS_JSON === '1';

const PER_CONN_RATE = Math.max(1, Math.round(RATE / CONNS));   // msg/s por conexión
const BATCH_MS = 20;                                            // envía en lotes cada 20 ms
const PER_BATCH = Math.max(1, Math.round(PER_CONN_RATE * BATCH_MS / 1000));

let testOver = false;
const stats = {
  rate: RATE, conns: CONNS,
  sent: 0,            // mensajes de flood enviados
  closedByServer: 0,  // veces que el servidor cerró una conexión atacante (rate-limit duro)
  attackersUp: 0,     // atacantes conectados ahora
  canaryPing: 0,      // ping del jugador legítimo durante el ataque
  cpu: 0,
};

// %CPU de este proceso (cliente del test) en el último intervalo
let _cpu = process.cpuUsage(), _cpuT = Date.now();
function cpuPct() {
  const u = process.cpuUsage(_cpu); const dt = Date.now() - _cpuT;
  _cpu = process.cpuUsage(); _cpuT = Date.now();
  return dt > 0 ? Math.round((u.user + u.system) / 1000 / dt * 100) : 0;
}

// --- Atacante: conecta y floodea; si el servidor lo cierra, reconecta y sigue ---
function attacker() {
  if (testOver) return;
  let ws;
  try { ws = new WebSocket(SERVER); } catch { setTimeout(attacker, 300); return; }
  let timer = null;
  let closedCounted = false;

  ws.on('open', () => {
    stats.attackersUp++;
    timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      for (let k = 0; k < PER_BATCH; k++) { ws.send('{"t":"input","tx":0,"ty":0}'); stats.sent++; }
    }, BATCH_MS);
  });
  ws.on('close', () => {
    if (timer) clearInterval(timer);
    stats.attackersUp = Math.max(0, stats.attackersUp - 1);
    // El servidor nos cerró por flood → contar y reconectar para seguir atacando
    if (!closedCounted) { stats.closedByServer++; closedCounted = true; }
    if (!testOver) setTimeout(attacker, 200 + Math.random() * 300);
  });
  ws.on('error', () => {});
}

// --- Canario: juega normal y mide su ping mientras dura el ataque ---
function canary() {
  let ws;
  try { ws = new WebSocket(SERVER); } catch { return; }
  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'join', mode: 'classic', room: 'Free', name: 'CANARIO' }));
    setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping', ts: Date.now() })); }, 1000);
    setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'input', tx: 0, ty: 0 })); }, 100);
  });
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'pong' && m.ts) stats.canaryPing = Date.now() - m.ts;
  });
  ws.on('error', () => {});
}

function snapshotStats(done) { stats.cpu = cpuPct(); return Object.assign({ done: !!done }, stats); }
function emitJson(done) { process.stdout.write('STATS ' + JSON.stringify(snapshotStats(done)) + '\n'); }

if (!JSON_MODE) {
  console.log(`\nPillWars DDoS test`);
  console.log(`Servidor : ${SERVER}`);
  console.log(`Ataque   : ${RATE} msg/s total · ${CONNS} conexiones (${PER_CONN_RATE}/s c/u)`);
  console.log(`Duración : ${DURATION_S}s`);
  console.log('─'.repeat(60));
}

canary();
for (let i = 0; i < CONNS; i++) setTimeout(attacker, i * 20);

const reportTimer = setInterval(() => {
  if (JSON_MODE) { emitJson(false); return; }
  process.stdout.write(`\r💥 enviados:${stats.sent}  atacantes:${stats.attackersUp}/${CONNS}  cerrados x servidor:${stats.closedByServer}  ping canario:${stats.canaryPing}ms  cpu:${cpuPct()}%   `);
}, 1000);

setTimeout(() => {
  testOver = true;
  clearInterval(reportTimer);
  if (JSON_MODE) { emitJson(true); process.exit(0); }
  console.log('\n\n' + '─'.repeat(60));
  console.log('RESULTADOS DDoS');
  console.log(`  Mensajes de flood enviados : ${stats.sent}`);
  console.log(`  Conexiones cerradas x servidor (rate-limit): ${stats.closedByServer}`);
  console.log(`  Ping del canario (jugador legítimo): ${stats.canaryPing} ms`);
  console.log('─'.repeat(60));
  console.log(stats.canaryPing && stats.canaryPing < 150
    ? '✅ El servidor aguantó: el jugador legítimo siguió con ping bajo.'
    : '⚠ Revisa: el canario no respondió o tuvo ping alto.');
  process.exit(0);
}, DURATION_S * 1000);
