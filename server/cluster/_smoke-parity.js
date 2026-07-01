'use strict';
// Smoke de paridad 4a.2: ejercita las funciones movidas a game-host.js contra un
// server mono-proceso real. join → welcome(foods)+waiting; admin forceStart →
// matchStart; ready → snapshot. Arranca su propio server en PORT_TEST.
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require(path.join(__dirname, '../../stress_bot/node_modules/ws'));

const PORT = 8090;
const srv = spawn(process.execPath, [path.join(__dirname, '../index.js')], {
    env: { ...process.env, PORT: String(PORT), ADMIN_KEY: '1234', MIN_PLAYERS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = '';
srv.stdout.on('data', d => { srvLog += d; });
srv.stderr.on('data', d => { srvLog += d; });

const results = {};
function done(ok) {
    srv.kill();
    console.log('\n--- resultado paridad ---');
    for (const [k, v] of Object.entries(results)) console.log(' ', v ? 'PASS' : 'FAIL', k);
    if (!ok) { console.log('\n--- server log ---\n' + srvLog.split('\n').slice(-25).join('\n')); }
    process.exit(ok ? 0 : 1);
}

setTimeout(() => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    let gotWelcome = false, gotStart = false, gotSnap = false, gotLb = false;
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', mode: 'classic', room: 'Free', name: 'ParityBot' })));
    ws.on('message', (data) => {
        let m; try { m = JSON.parse(data); } catch { return; }   // los snap binarios no; aquí todo JSON
        if (m.t === 'welcome') {
            gotWelcome = true;
            results['join → welcome (welcomeMsg)'] = true;
            results['welcome trae foods (foodsJsonOf)'] = Array.isArray(m.foods) && m.foods.length > 0;
            // Forzar inicio de la partida vía admin (ejercita startMatch).
            const admin = new WebSocket(`ws://localhost:${PORT}`);
            admin.on('open', () => admin.send(JSON.stringify({ t: 'admin', key: '1234', cmd: 'forceStart', room: 'classic_Free_L1' })));
        } else if (m.t === 'waiting') {
            results['join → waiting (sendWaiting/armLobby)'] = true;
        } else if (m.t === 'matchStart') {
            gotStart = true;
            results['forceStart → matchStart (startMatch)'] = true;
            ws.send(JSON.stringify({ t: 'ready' }));
        } else if (m.t === 'snap' || m.t === 'events') {
            if (gotStart && !gotSnap) { gotSnap = true; results['ready → snapshot/eventos (tick)'] = true; }
        } else if (m.t === 'lb') {
            if (!gotLb && Array.isArray(m.top)) { gotLb = true; results['leaderboard de sala (server → lb)'] = true; }
        }
    });
    ws.on('error', e => { results['conexión'] = false; srvLog += '\nWS ERR ' + e.message; });

    setTimeout(() => {
        const ok = gotWelcome && results['welcome trae foods (foodsJsonOf)'] &&
            results['join → waiting (sendWaiting/armLobby)'] && gotStart && gotSnap && gotLb;
        done(ok);
    }, 3500);
}, 1500);
