'use strict';
// Test 4a.4.3: el dinero cruza por IPC (host → director) sin relajar validaciones.
//
// Escenario A (end-to-end real): arranca un Director que forkea 2 hosts, prepara
// una wallet de test con saldo WAR (firma nacl REAL, la misma verificación que
// producción) y comprueba:
//   - join a sala de pago en el HOST → el warbank del DIRECTOR se debita (IPC)
//   - cerrar el socket con la sala sin empezar → reembolso vía IPC (onPlayerLeave)
//   - reusar la misma firma → rechazada ('firma ya usada', anti-replay cross-proceso)
//   - join de pago sin firma → payRequired
//
// Escenario B (fail-closed): un host forkeado por un "director" que NUNCA responde
// a authorizeEntry → el join debe terminar en payRequired (timeout IPC), jamás en
// welcome. Si el Director no contesta, NADIE entra sin pagar.
//
// Ejecutar: node server/cluster/_test-ipc-money.js   (tarda ~15s por el timeout IPC)
const fs = require('fs');
const path = require('path');
const { spawn, fork } = require('child_process');
const nacl = require('tweetnacl');
const { PublicKey } = require('@solana/web3.js');
const WebSocket = require('ws');
const { createIpc } = require('./ipc.js');

const INDEX = path.join(__dirname, '../index.js');
const WARBANK_FILE = path.join(__dirname, '../warbalances.json');
const DIR_PORT = 8095;
const RATE = 10000;                 // PILL por $1, fijado por env para el test
const FEE = 5 * RATE;               // entrada de la sala 5$
const START_BALANCE = 1000000;

// Wallet de test: keypair ed25519 real (mismo esquema que Phantom/Solana).
const kp = nacl.sign.keyPair();
const WALLET = new PublicKey(Buffer.from(kp.publicKey)).toBase58();
function signedEntry(comboKey, fee) {
    const ts = Date.now();
    const message = `PillWars enter ${comboKey} paying ${fee} PILL @ ${ts}`;
    const signature = Array.from(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
    return { wallet: WALLET, ts, message, signature };
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
    if (ok) pass++; else fail++;
    console.log(' ', ok ? 'PASS' : 'FAIL', name + (ok || !detail ? '' : ' → ' + detail));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function warBalance() {
    const res = await fetch(`http://localhost:${DIR_PORT}/api/warbalance?wallet=${WALLET}`);
    return (await res.json()).pill;
}
// Abre un WS, manda un join y devuelve el primer mensaje relevante (welcome/payRequired/...)
function tryJoin(port, joinMsg, timeoutMs) {
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        const timer = setTimeout(() => { try { ws.close(); } catch (e) {} resolve({ t: '_timeout' }); }, timeoutMs || 4000);
        ws.on('open', () => ws.send(JSON.stringify(joinMsg)));
        ws.on('message', (data) => {
            let m; try { m = JSON.parse(data); } catch (e) { return; }
            if (['welcome', 'payRequired', 'kickedWait', 'noSlot', 'resumeFail'].includes(m.t)) {
                clearTimeout(timer);
                resolve(Object.assign(m, { _ws: ws }));
            }
        });
        ws.on('error', (e) => { clearTimeout(timer); resolve({ t: '_error', error: e.message }); });
    });
}

// --- Preparación del warbank: backup + saldo inicial para la wallet de test ---
const hadFile = fs.existsSync(WARBANK_FILE);
const backup = hadFile ? fs.readFileSync(WARBANK_FILE) : null;
fs.writeFileSync(WARBANK_FILE, JSON.stringify({ balances: { [WALLET]: START_BALANCE }, sigs: {} }));

let director = null, fakeHost = null;
function cleanup() {
    try { if (director) director.kill(); } catch (e) {}
    try { if (fakeHost) fakeHost.kill(); } catch (e) {}
}
function restoreWarbank() {
    try { if (hadFile) fs.writeFileSync(WARBANK_FILE, backup); else fs.unlinkSync(WARBANK_FILE); } catch (e) {}
}

async function scenarioA() {
    console.log('--- Escenario A: cobro/reembolso/anti-replay vía IPC (director real + 2 hosts) ---');
    director = spawn(process.execPath, [INDEX], {
        env: { ...process.env, PORT: String(DIR_PORT), PW_ROLE: 'director', PW_HOST_COUNT: '2', PILL_PER_DOLLAR: String(RATE), ADMIN_KEY: '1234' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    director.logBuf = '';
    director.stdout.on('data', d => { director.logBuf += d; });
    director.stderr.on('data', d => { director.logBuf += d; });
    await sleep(3000);

    // El matchmaker nos dice qué host sirve classic_5$
    const match = await (await fetch(`http://localhost:${DIR_PORT}/match?mode=classic&price=5$`)).json();
    check('match resuelve host para classic_5$', match.ok === true && match.port > DIR_PORT, JSON.stringify(match));

    // 1) Entrada pagada: join al HOST con firma real → welcome + débito en el DIRECTOR
    const pay = signedEntry('classic_5$', FEE);
    const j1 = await tryJoin(match.port, { t: 'join', mode: 'classic', room: '5$', name: 'IpcPayBot', pay });
    check('join de pago vía host → welcome (cobro IPC autorizado)', j1.t === 'welcome', JSON.stringify({ t: j1.t, reason: j1.reason }));
    const b1 = await warBalance();
    check(`warbank del Director debitado (${START_BALANCE} → ${b1})`, b1 === START_BALANCE - FEE);

    // 2) Reembolso: cerrar el socket con la sala aún en waiting → la entrada vuelve
    if (j1._ws) j1._ws.close();
    await sleep(1500);
    const b2 = await warBalance();
    check(`reembolso vía IPC al salir sin empezar (${b1} → ${b2})`, b2 === START_BALANCE);

    // 3) Anti-replay cross-proceso: la MISMA firma no puede volver a entrar
    const j2 = await tryJoin(match.port, { t: 'join', mode: 'classic', room: '5$', name: 'ReplayBot', pay });
    check('firma reusada → rechazada (anti-replay en el Director)', j2.t === 'payRequired' && /ya usada/.test(j2.reason || ''), JSON.stringify({ t: j2.t, reason: j2.reason }));
    if (j2._ws) try { j2._ws.close(); } catch (e) {}
    const b3 = await warBalance();
    check('el rechazo no toca el saldo', b3 === START_BALANCE);

    // 4) Sin firma → payRequired (la sala de pago sigue exigiendo pago vía IPC)
    const j3 = await tryJoin(match.port, { t: 'join', mode: 'classic', room: '5$', name: 'NoPayBot' });
    check('join de pago sin firma → payRequired', j3.t === 'payRequired', JSON.stringify({ t: j3.t }));
    if (j3._ws) try { j3._ws.close(); } catch (e) {}

    director.kill();
    await sleep(500);
}

async function scenarioB() {
    console.log('--- Escenario B: fail-closed si el Director no responde (timeout IPC) ---');
    const HOST_PORT = 8099;
    // El test hace de "director" que forkea el host pero NUNCA responde authorizeEntry.
    fakeHost = fork(INDEX, [], {
        // classic_5$ pertenece al host 1 de 2 (orden lexicográfico del shard-map:
        // '$' < '0' → arcade_5$ va antes que arcade_50$ → classic_5$ cae en índice 7).
        env: { ...process.env, PORT: String(HOST_PORT), PW_ROLE: 'host', PW_HOST_ID: '1', PW_HOST_COUNT: '2', PILL_PER_DOLLAR: String(RATE), ADMIN_KEY: '1234' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    fakeHost.stdout.on('data', () => {});
    fakeHost.stderr.on('data', () => {});
    const ipc = createIpc(fakeHost, { label: 'fake-director' });
    ipc.handle('checkKick', () => null);                        // el kick sí responde
    ipc.handle('authorizeEntry', () => new Promise(() => {}));  // el dinero NUNCA responde
    ipc.notify('oracleRate', { rate: RATE });
    await sleep(1800);

    // El cobro debe hacer timeout (5s) y terminar en payRequired — bajo NINGÚN
    // concepto en welcome.
    const pay = signedEntry('classic_5$', FEE);
    const j = await tryJoin(HOST_PORT, { t: 'join', mode: 'classic', room: '5$', name: 'TimeoutBot', pay }, 8000);
    check('IPC sin respuesta → payRequired tras timeout (fail-closed, no entra sin pagar)',
        j.t === 'payRequired' && /no disponible/.test(j.reason || ''), JSON.stringify({ t: j.t, reason: j.reason }));
    if (j._ws) try { j._ws.close(); } catch (e) {}

    fakeHost.kill();
}

(async () => {
    try {
        await scenarioA();
        await scenarioB();
    } catch (e) {
        fail++;
        console.log('  FAIL (excepción):', e.message);
        if (director && director.logBuf) console.log('--- director log ---\n' + director.logBuf.split('\n').slice(-25).join('\n'));
    } finally {
        cleanup();
        await sleep(500);
        restoreWarbank();
    }
    console.log(`\n${fail === 0 ? 'OK' : 'FALLOS'}: ${pass} pass, ${fail} fail`);
    if (fail > 0 && director && director.logBuf) console.log('\n--- director log ---\n' + director.logBuf.split('\n').slice(-30).join('\n'));
    setTimeout(() => process.exit(fail === 0 ? 0 : 1), 300);
})();
