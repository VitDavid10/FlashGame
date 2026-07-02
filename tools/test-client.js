/*
 * Cliente de prueba headless: se conecta al servidor como un jugador real
 * y se mueve en círculos alrededor de su punto de aparición.
 *
 * Uso: node server/test-client.js [nombre] [sala]
 */
'use strict';

const WebSocket = require('ws');

const NAME = process.argv[2] || 'TestBot';
const ROOM = process.argv[3] || '5$';
const URL = process.env.SERVER || 'ws://localhost:8080';

const ws = new WebSocket(URL);
let myId = null;
let center = null;
let angle = 0;
let lastSnap = null;

ws.on('open', () => {
    console.log(`[${NAME}] conectado a ${URL}, entrando en sala ${ROOM}...`);
    ws.send(JSON.stringify({ t: 'join', room: ROOM, name: NAME, colorBot: '#ff8800', colorTop: '#222222', config: {} }));
});

ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.t === 'welcome') {
        myId = msg.id;
        console.log(`[${NAME}] dentro. id=${myId}, mapa=${msg.mapSize}, comida=${msg.foods.length}`);
    } else if (msg.t === 'snap') {
        lastSnap = msg;
        const yo = msg.players.find(p => p.id === myId);
        if (yo && yo.cells.length > 0 && !center) { center = { x: yo.cells[0].x, y: yo.cells[0].y }; }
        if (yo && yo.cells.length === 0 && yo.alive === false) { console.log(`[${NAME}] me han comido. GAME OVER.`); }
    } else if (msg.t === 'events') {
        for (const ev of msg.events) {
            if (ev.type === 'botKilled' && ev.playerId === myId) console.log(`[${NAME}] ¡he matado a ${ev.botName}! racha=${ev.streak}`);
            if (ev.type === 'playerDied' && ev.playerId === myId) console.log(`[${NAME}] evento: he muerto.`);
        }
    }
});

// Movimiento: círculos de radio 400 alrededor del spawn, input a 20 Hz
setInterval(() => {
    if (ws.readyState !== 1 || !center) return;
    angle += 0.05;
    ws.send(JSON.stringify({ t: 'input', tx: center.x + Math.cos(angle) * 400, ty: center.y + Math.sin(angle) * 400 }));
}, 50);

// Resumen periódico
setInterval(() => {
    if (!lastSnap || !myId) return;
    const yo = lastSnap.players.find(p => p.id === myId);
    if (yo && yo.cells.length > 0) {
        const masa = yo.cells.reduce((s, c) => s + Math.PI * c.r * c.r * 2, 0);
        console.log(`[${NAME}] celdas=${yo.cells.length} masa=${Math.floor(masa)} pos=(${Math.round(yo.cells[0].x)},${Math.round(yo.cells[0].y)}) jugadores=${lastSnap.players.length}`);
    }
}, 5000);

ws.on('close', () => { console.log(`[${NAME}] desconectado.`); process.exit(0); });
ws.on('error', e => { console.error(`[${NAME}] error:`, e.message); process.exit(1); });
