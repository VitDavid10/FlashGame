#!/usr/bin/env node
/**
 * Stress test para PillWars.
 * Abre N conexiones WebSocket reales, simula jugadores entrando a distintas salas
 * y envía inputs aleatorios continuamente.
 *
 * Uso:
 *   node stress-test.js [opciones]
 *
 * Opciones (variables de entorno):
 *   SERVER=ws://localhost:8080   URL del servidor
 *   BOTS=30                      Total de conexiones a abrir
 *   RAMP_MS=100                  Milisegundos entre cada conexión nueva (evita picos)
 *   INPUT_HZ=20                  Inputs por segundo por bot (20 = 1 cada 50ms)
 *   ROOMS=classic_Free,arcade_Free,classic_5$   Salas a repartir (separadas por coma)
 *   DURATION_S=60                Segundos que dura el test (0 = indefinido)
 */

'use strict';

const WebSocket = require('ws');

const SERVER     = process.env.SERVER     || 'ws://localhost:8080';
const BOTS       = parseInt(process.env.BOTS      || '30',  10);
const RAMP_MS    = parseInt(process.env.RAMP_MS   || '100', 10);
const INPUT_HZ   = parseInt(process.env.INPUT_HZ  || '20',  10);
const DURATION_S = parseInt(process.env.DURATION_S || '60', 10);
const ROOMS      = (process.env.ROOMS || 'classic_Free,arcade_Free').split(',');

const INPUT_INTERVAL = Math.max(16, Math.round(1000 / INPUT_HZ));

// Estadísticas en tiempo real
const stats = {
  connected: 0,
  disconnected: 0,
  errors: 0,
  messagesSent: 0,
  messagesReceived: 0,
  latencies: [],        // últimas 200 latencias (ms)
};

function randomRoom() { return ROOMS[Math.floor(Math.random() * ROOMS.length)]; }
function randomName(i) { return `Stress${i}`; }
function randomColor() { return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); }

function avgLatency() {
  if (!stats.latencies.length) return 0;
  return Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length);
}

function spawnBot(i) {
  const roomKey  = randomRoom();
  // El servidor espera mode + roomName por separado
  const [mode, ...rest] = roomKey.split('_');
  const roomName = rest.join('_');

  let ws;
  try { ws = new WebSocket(SERVER); } catch { stats.errors++; return; }

  let inputTimer = null;
  let pingTimer  = null;
  let lastPing   = 0;

  ws.on('open', () => {
    stats.connected++;

    // Mensaje join con el protocolo real del servidor
    ws.send(JSON.stringify({
      t: 'join',
      mode,
      room: roomName,
      name: randomName(i),
      colorBot: randomColor(),
      colorTop: randomColor(),
    }));
    stats.messagesSent++;

    // Input aleatorio continuo
    inputTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // tx/ty = dirección normalizada donde quiere ir
      const angle = Math.random() * Math.PI * 2;
      ws.send(JSON.stringify({ t: 'input', tx: Math.cos(angle), ty: Math.sin(angle) }));
      stats.messagesSent++;
    }, INPUT_INTERVAL);

    // Ping cada 5s para medir latencia
    pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      lastPing = Date.now();
      ws.send(JSON.stringify({ t: 'ping' }));
      stats.messagesSent++;
    }, 5000);
  });

  ws.on('message', () => {
    stats.messagesReceived++;
    if (lastPing) {
      stats.latencies.push(Date.now() - lastPing);
      if (stats.latencies.length > 200) stats.latencies.shift();
      lastPing = 0;
    }
  });

  ws.on('close', () => {
    stats.disconnected++;
    clearInterval(inputTimer);
    clearInterval(pingTimer);
  });

  ws.on('error', () => {
    stats.errors++;
  });
}

// --- Arranque escalonado ---
console.log(`\nPillWars Stress Test`);
console.log(`Servidor : ${SERVER}`);
console.log(`Bots     : ${BOTS}`);
console.log(`Salas    : ${ROOMS.join(', ')}`);
console.log(`Ramp     : ${RAMP_MS}ms entre conexiones`);
console.log(`Inputs   : ${INPUT_HZ} Hz por bot`);
console.log(`Duración : ${DURATION_S ? DURATION_S + 's' : 'indefinido'}`);
console.log('─'.repeat(50));

let launched = 0;
const rampTimer = setInterval(() => {
  if (launched >= BOTS) { clearInterval(rampTimer); return; }
  spawnBot(launched);
  launched++;
}, RAMP_MS);

// --- Reporte cada 2 segundos ---
const reportTimer = setInterval(() => {
  const active = stats.connected - stats.disconnected;
  process.stdout.write(
    `\r⚡ Activos: ${active.toString().padStart(4)}/${BOTS}` +
    `  ↑ ${stats.messagesSent.toString().padStart(7)} msgs enviados` +
    `  ↓ ${stats.messagesReceived.toString().padStart(7)} recibidos` +
    `  ⚠ ${stats.errors} errores` +
    `  ping ~${avgLatency()}ms   `
  );
}, 2000);

// --- Fin del test ---
if (DURATION_S > 0) {
  setTimeout(() => {
    clearInterval(rampTimer);
    clearInterval(reportTimer);
    const active = stats.connected - stats.disconnected;
    console.log('\n\n' + '─'.repeat(50));
    console.log('RESULTADOS FINALES');
    console.log(`  Conexiones abiertas    : ${stats.connected}`);
    console.log(`  Desconexiones          : ${stats.disconnected}`);
    console.log(`  Activos al finalizar   : ${active}`);
    console.log(`  Errores de conexión    : ${stats.errors}`);
    console.log(`  Mensajes enviados      : ${stats.messagesSent}`);
    console.log(`  Mensajes recibidos     : ${stats.messagesReceived}`);
    console.log(`  Latencia media (ping)  : ${avgLatency()}ms`);
    console.log('─'.repeat(50));
    process.exit(0);
  }, DURATION_S * 1000);
}
