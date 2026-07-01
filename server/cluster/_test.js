'use strict';
// Test de las piezas base de Fase 4: shard-map (puro) e ipc (fork real).
// Ejecutar: node server/cluster/_test.js   → imprime PASS/FAIL por caso.
const assert = require('assert');
const { fork } = require('child_process');
const path = require('path');
const { listCombos, buildShardMap } = require('./shard-map.js');
const { createIpc } = require('./ipc.js');

let pass = 0, fail = 0;
function check(name, fn) {
    return Promise.resolve().then(fn).then(
        () => { pass++; console.log('  PASS', name); },
        (e) => { fail++; console.log('  FAIL', name, '→', e.message); }
    );
}

const MODES = ['classic', 'arcade'];
const PRICES = ['Free', '5$', '10$', '20$', '50$'];

async function main() {
    // --- shard-map ---
    await check('listCombos: 10 combos ordenados y estables', () => {
        const a = listCombos(MODES, PRICES);
        const b = listCombos(['arcade', 'classic'], ['50$', 'Free', '10$', '20$', '5$']);
        assert.strictEqual(a.length, 10);
        assert.deepStrictEqual(a, b, 'el orden debe ser independiente del orden de entrada');
    });

    await check('buildShardMap: determinista (mismo combo, mismo host)', () => {
        const m1 = buildShardMap(MODES, PRICES, 3);
        const m2 = buildShardMap(MODES, PRICES, 3);
        for (const [combo, host] of m1.comboToHost) {
            assert.strictEqual(m2.comboToHost.get(combo), host, combo + ' cambió de host');
        }
    });

    await check('buildShardMap: balanceado (diferencia <= 1)', () => {
        const { hostToCombos } = buildShardMap(MODES, PRICES, 3);
        const sizes = [...hostToCombos.values()].map(c => c.length);
        assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, 'sizes=' + sizes);
        assert.strictEqual(sizes.reduce((a, b) => a + b, 0), 10, 'no se pierde ningún combo');
    });

    await check('buildShardMap: todo combo tiene host y sin duplicados', () => {
        const { comboToHost, hostToCombos } = buildShardMap(MODES, PRICES, 4);
        const all = [...hostToCombos.values()].flat();
        assert.strictEqual(all.length, 10);
        assert.strictEqual(new Set(all).size, 10, 'combos duplicados');
        assert.strictEqual(comboToHost.size, 10);
    });

    await check('buildShardMap: hostCount inválido lanza', () => {
        assert.throws(() => buildShardMap(MODES, PRICES, 0));
    });

    // --- ipc (fork real) ---
    const child = fork(path.join(__dirname, '_test-child.js'), { silent: false });
    const ipc = createIpc(child, { label: 'parent', timeoutMs: 2000 });
    let childDone = null;
    ipc.handle('charge', async (data) => {
        // Simula el warbank del Director: cobra y devuelve saldo.
        assert.strictEqual(data.wallet, 'W1');
        return { ok: true, debited: data.amount, balance: 1000000 - data.amount };
    });
    ipc.handle('childDone', (data) => { childDone = data; });

    await check('ipc: request padre→hijo devuelve respuesta', async () => {
        const res = await ipc.request('echo', { hello: 'world' });
        assert.deepStrictEqual(res.got, { hello: 'world' });
        assert.ok(res.pid > 0);
    });

    await check('ipc: handler que lanza propaga el error', async () => {
        await assert.rejects(() => ipc.request('boom', {}), /explota a propósito/);
    });

    await check('ipc: type sin handler rechaza', async () => {
        await assert.rejects(() => ipc.request('noExiste', {}), /no handler/);
    });

    await check('ipc: request hijo→padre (dinero cross-proceso) funcionó', async () => {
        // Esperar a que el hijo termine su request 'charge'.
        for (let i = 0; i < 40 && !childDone; i++) await new Promise(r => setTimeout(r, 25));
        assert.ok(childDone, 'el hijo no reportó childDone a tiempo');
        assert.ok(!childDone.error, 'hijo error: ' + childDone.error);
        assert.strictEqual(childDone.charged.debited, 50000);
        assert.strictEqual(childDone.charged.balance, 950000);
    });

    await check('ipc: timeout si nadie responde', async () => {
        // Pedimos un type que el hijo no maneja pero por notify (no responde nunca).
        // Usamos un ipc con timeout corto sobre un canal muerto simulado.
        const dead = { on() {}, send() {} };
        const d = createIpc(dead, { label: 'dead', timeoutMs: 100 });
        await assert.rejects(() => d.request('x', {}), /timeout/);
    });

    child.kill();
    console.log(`\n${fail === 0 ? 'OK' : 'FALLOS'}: ${pass} pass, ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
}

main();
