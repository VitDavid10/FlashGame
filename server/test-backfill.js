/*
 * Prueba del backfill: 1 real + forzar inicio → 9 bots; entra 2º real → 8 bots;
 * se va el 2º → 9 bots de nuevo.
 *
 * Uso: node server/test-backfill.js
 */
'use strict';

const WebSocket = require('ws');
const URL = process.env.SERVER || 'ws://localhost:8080';
const KEY = process.env.ADMIN_KEY || '1234';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function ghost(name) {
    const ws = new WebSocket(URL);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room: 'Free', name, colorBot: '#ff8800', colorTop: '#222', config: {} })));
    ws.on('message', () => {});
    ws.on('error', () => {});
    return ws;
}

function estadoSala() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(URL);
        ws.on('open', () => ws.send(JSON.stringify({ t: 'admin', key: KEY, cmd: 'state' })));
        ws.on('message', raw => {
            const m = JSON.parse(raw);
            if (m.t === 'adminState') {
                ws.close();
                resolve(m.rooms.find(r => r.key === 'classic_Free'));
            }
        });
        ws.on('error', reject);
    });
}

function forceStart() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(URL);
        ws.on('open', () => { ws.send(JSON.stringify({ t: 'admin', key: KEY, cmd: 'forceStart', room: 'classic_Free' })); setTimeout(() => { ws.close(); resolve(); }, 300); });
        ws.on('error', reject);
    });
}

(async () => {
    const g1 = ghost('Probador1');
    await sleep(800);
    let r = await estadoSala();
    console.log(`1) Tras entrar 1 real: estado=${r.state} reales=${r.conectados} bots=${r.bots} (esperado: waiting, 1, 0)`);

    await forceStart();
    await sleep(500);
    r = await estadoSala();
    console.log(`2) Tras forzar inicio: estado=${r.state} reales=${r.conectados} bots=${r.bots} (esperado: playing, 1, 9)`);

    const g2 = ghost('Probador2');
    await sleep(800);
    r = await estadoSala();
    console.log(`3) Entra 2º real:     estado=${r.state} reales=${r.conectados} bots=${r.bots} (esperado: playing, 2, 8)`);

    g2.close();
    await sleep(800);
    r = await estadoSala();
    console.log(`4) Se va el 2º real:  estado=${r.state} reales=${r.conectados} bots=${r.bots} (esperado: playing, 1, 9)`);

    g1.close();
    console.log('FIN');
    process.exit(0);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
