'use strict';
// Smoke 4a.4.2: el Director forkea los hosts y /match enruta cada combo al host
// correcto. Arranca un director real (PW_ROLE=director, 2 hosts) y un mono de
// control, y verifica:
//   - /match devuelve para los 10 combos el puerto del host que dicta el shard-map
//   - los 2 hosts forkeados están vivos y pre-crearon SOLO sus 5 combos (5 salas L1)
//   - en modo mono /match devuelve el propio puerto (compat: el flujo actual no cambia)
// Ejecutar: node server/cluster/_smoke-director.js
const { spawn } = require('child_process');
const path = require('path');
const { buildShardMap } = require('./shard-map.js');

const DIR_PORT = 8095;
const MONO_PORT = 8098;
const HOSTS = 2;
const MODES = ['classic', 'arcade'];
const PRICES = ['Free', '5$', '10$', '20$', '50$'];

const INDEX = path.join(__dirname, '../index.js');
function boot(env) {
    const p = spawn(process.execPath, [INDEX], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    p.logBuf = '';
    p.stdout.on('data', d => { p.logBuf += d; });
    p.stderr.on('data', d => { p.logBuf += d; });
    return p;
}
const director = boot({ PORT: String(DIR_PORT), PW_ROLE: 'director', PW_HOST_COUNT: String(HOSTS), ADMIN_KEY: '1234' });
const mono = boot({ PORT: String(MONO_PORT), ADMIN_KEY: '1234' });

const results = {};
let pass = 0, fail = 0;
function check(name, ok, detail) {
    results[name] = ok;
    if (ok) pass++; else fail++;
    console.log(' ', ok ? 'PASS' : 'FAIL', name + (ok || !detail ? '' : ' → ' + detail));
}
async function getJson(url) {
    const res = await fetch(url);
    return res.json();
}

async function main() {
    // Dar tiempo a que el director forkee y los hosts levanten su HTTP.
    await new Promise(r => setTimeout(r, 3000));

    // 1) /match reparte los 10 combos según el shard-map (puerto = base+1+hostId)
    const { comboToHost } = buildShardMap(MODES, PRICES, HOSTS);
    let matchOk = true, matchDetail = '';
    for (const mode of MODES) for (const price of PRICES) {
        const j = await getJson(`http://localhost:${DIR_PORT}/match?mode=${mode}&price=${encodeURIComponent(price)}`);
        const expected = DIR_PORT + 1 + comboToHost.get(mode + '_' + price);
        if (!j.ok || j.port !== expected) { matchOk = false; matchDetail += `${mode}_${price}: esperaba ${expected}, llegó ${JSON.stringify(j)}; `; }
    }
    check('director /match enruta los 10 combos al host del shard-map', matchOk, matchDetail);

    // 2) combo inexistente → rechazado
    const bad = await getJson(`http://localhost:${DIR_PORT}/match?mode=classic&price=99$`);
    check('director /match rechaza combo desconocido', bad.ok === false);

    // 3) los 2 hosts viven y pre-crearon SOLO sus combos (5 salas L1 cada uno)
    for (let h = 0; h < HOSTS; h++) {
        try {
            const health = await getJson(`http://localhost:${DIR_PORT + 1 + h}/api/health`);
            check(`host ${h} vivo con sus 5 salas L1 (rooms=${health.rooms})`, health.rooms === 5);
        } catch (e) {
            check(`host ${h} vivo con sus 5 salas L1`, false, e.message);
        }
    }

    // 4) el director NO corre salas propias
    const dh = await getJson(`http://localhost:${DIR_PORT}/api/health`);
    check(`director sin salas propias (rooms=${dh.rooms})`, dh.rooms === 0);

    // 4b) consultar /api/rooms al director NO le hace lazy-create de salas
    // (regresión: pickLayer interpretaba su rooms vacío como "L1 llena" y creaba L2)
    await getJson(`http://localhost:${DIR_PORT}/api/rooms`);
    const dh2 = await getJson(`http://localhost:${DIR_PORT}/api/health`);
    check(`director sigue sin salas tras /api/rooms (rooms=${dh2.rooms})`, dh2.rooms === 0);

    // 5) modo mono: /match devuelve su propio puerto (compat total)
    const jm = await getJson(`http://localhost:${MONO_PORT}/match?mode=arcade&price=5$`);
    check('mono /match devuelve su propio puerto', jm.ok === true && jm.port === MONO_PORT);

    done();
}

function done() {
    try { director.kill(); } catch (e) {}
    try { mono.kill(); } catch (e) {}
    console.log(`\n${fail === 0 ? 'OK' : 'FALLOS'}: ${pass} pass, ${fail} fail`);
    if (fail > 0) {
        console.log('\n--- director log ---\n' + director.logBuf.split('\n').slice(-30).join('\n'));
        console.log('\n--- mono log ---\n' + mono.logBuf.split('\n').slice(-15).join('\n'));
    }
    // Salida diferida: process.exit() inmediato con sockets de fetch aún cerrándose
    // dispara un assert de libuv en Windows (async.c). 300ms deja drenar los handles.
    setTimeout(() => process.exit(fail === 0 ? 0 : 1), 300);
}

main().catch(e => { console.error('ERROR', e); fail++; done(); });
