'use strict';
// Test del ciclo desconexión → rejoin del GameHost (handleClose / handleJoin resume).
//
// El bug: el path de resume recreaba el cliente SIN nada económico (carry, payWallet,
// cid, isTester), porque es código anterior a la economía. Volvías con carry undefined
// —que en classic convertía tu carry en NaN a la primera kill—, sin wallet (el reparto
// del TOP de arcade te pagaba 0) y sin quests. Y restaurarlo sin más habría pagado dos
// veces: el 'close' liquidaba (cashout/reembolso) en el acto.
//
// La regla que se verifica aquí: un socket caído NO es una salida. El dinero se congela
// en room.parked hasta que se sabe si vuelve. Vuelve → intacto. No vuelve → se liquida
// UNA vez al expirar la gracia. Sale a propósito ({t:'leave'}) → se liquida al instante.
//
// Ejecutar: node server/cluster/_test-resume.js
const assert = require('assert');
const { createGameHost } = require('../game-host.js');

let pass = 0, fail = 0;
function check(name, fn) { try { fn(); pass++; console.log('  PASS', name); } catch (e) { fail++; console.log('  FAIL', name, '→', e.message); } }

const FEE = 500;
// --- Dobles de prueba ---
function fakeWs() { return { readyState: 1, sent: [], send(m) { this.sent.push(m); }, close() { this.readyState = 3; } }; }
function msgsOf(ws, t) { return ws.sent.map(m => { try { return JSON.parse(m); } catch (e) { return {}; } }).filter(m => m.t === t); }
// sim mínima: solo lo que tocan handleJoin/handleClose/welcomeMsg.
function fakeSim() {
    return {
        mapSize: 1000, now: 0, foods: [], players: new Map(),
        addPlayer(id, opts) { this.players.set(id, { id, name: (opts && opts.name) || '', alive: false, peakMass: 0, killStreak: 0, cells: [] }); },
        spawnPlayer(id) { const p = this.players.get(id); if (p) p.alive = true; },
    };
}
function makeHost(mode) {
    const rooms = new Map();
    const resumeTokens = new Map();
    const leaves = [];      // llamadas a director.onPlayerLeave
    const refunds = [];     // llamadas a director.refundEntry
    const room = {
        key: mode + '_5$_L1', comboKey: mode + '_5$', layerIdx: 1, mode, roomName: '5$',
        sim: fakeSim(), clients: new Map(), state: 'playing',
        tickCount: 0, lastTick: Date.now(), emptySince: 0,
        endsAt: null, restartAt: null, startAt: null,
        pendingRemovals: new Map(), parked: new Map(), deadRemovals: new Map(),
        spectators: new Set(), persistent: true, pot: 0, pillRate: 10000,
    };
    rooms.set(room.key, room);
    const director = {
        onPlayerLeave: (p) => leaves.push(p),
        refundEntry: (p) => refunds.push(p),
        checkKick: () => null,
        lockPriceIfEmpty: () => {},
        authorizeEntry: ({ fee }) => ({ ok: true, payWallet: 'WalletX', fee, tester: false }),
        recordEntry: () => {},
    };
    const host = createGameHost({
        rooms,
        comboKeyOf: (m, r) => m + '_' + r,
        layerKeyOf: (m, r, i) => m + '_' + r + '_L' + i,
        isLayerEnabled: () => true,
        rulesOf: () => ({}), minRealOf: () => 1, targetPopOf: () => 0,
        maxPlayersOf: () => 30, lobbyMsOf: () => 0,
        log: () => {}, onRulesDirty: () => {},
        CATALOG_MODES: ['classic', 'arcade'], PRICES: ['5$'], LAYERS_PER_COMBO: 4,
        ownsCombo: () => true, MATCH_MS: 300000,
        resumeTokens, SPAWN_IMMUNE_MS: 3000,
        director, RESUME_GRACE_MS: 30000,
        sendEcon: (cli, r) => { if (cli && cli.ws && cli.ws.readyState === 1) cli.ws.send(JSON.stringify({ t: 'econ', carry: cli.carry | 0, pot: r.pot | 0, entry: cli.entryFee | 0 })); },
        entryFeePill: () => FEE,
    });
    return { host, room, rooms, resumeTokens, leaves, refunds };
}
// join real (handleJoin es async) + spawn, como un jugador que ya está en partida.
async function joinPlaying(h, mode) {
    const ws = fakeWs();
    const res = await h.host.handleJoin(ws, '1.2.3.4', { t: 'join', mode, room: '5$', name: 'Dave', cid: 'cid-dave' });
    assert.ok(res, 'el join debería entrar');
    const cli = h.room.clients.get(res.playerId);
    cli._spawned = true;
    h.room.sim.spawnPlayer(res.playerId);
    return { ws, playerId: res.playerId, cli, token: cli.token };
}

(async () => {

// --- 1: la desconexión NO liquida, aparca ---
await (async () => {
    const h = makeHost('classic');
    const p = await joinPlaying(h, 'classic');
    p.cli.carry = 900;   // mató a alguien
    h.host.handleClose(p.ws, h.room, p.playerId, null);
    check('close accidental: no liquida, aparca el dinero', () => {
        assert.strictEqual(h.leaves.length, 0, 'un socket caído no es una salida: nada de cashout todavía');
        const pk = h.room.parked.get(p.playerId);
        assert.ok(pk, 'debería quedar aparcado');
        assert.strictEqual(pk.carry, 900);
        assert.strictEqual(pk.payWallet, 'WalletX');
        assert.strictEqual(pk.cid, 'cid-dave');
        assert.ok(h.room.pendingRemovals.has(p.playerId), 'la célula sigue viva con su gracia');
    });

    // --- 2: el resume lo devuelve INTACTO (el bug original) ---
    const ws2 = fakeWs();
    const res2 = await h.host.handleJoin(ws2, '1.2.3.4', { t: 'join', resume: p.token });
    check('resume: carry/payWallet/cid/entryFee vuelven intactos', () => {
        assert.ok(res2, 'el resume debería entrar');
        const cli = h.room.clients.get(p.playerId);
        assert.strictEqual(cli.carry, 900, 'el carry vuelve tal cual (antes: undefined → NaN a la primera kill)');
        assert.strictEqual(cli.payWallet, 'WalletX', 'sin wallet no cobraría ni el reparto del TOP');
        assert.strictEqual(cli.cid, 'cid-dave', 'sin cid pierde las quests el resto de la partida');
        assert.strictEqual(cli.entryFee, FEE, 'la entrada pagada alimenta el "YOU LOST" del GAME OVER');
        assert.strictEqual(cli.isTester, false);
        assert.strictEqual(cli._spawned, true, 'ya spawneado: un ready tardío no debe respawnearlo');
        assert.strictEqual(h.room.parked.size, 0, 'sale del aparcadero al volver');
        assert.strictEqual(h.leaves.length, 0, 'volver no dispara ninguna liquidación');
    });
    check('resume: sendEcon repinta carry/bote/entrada', () => {
        const econ = msgsOf(ws2, 'econ');
        assert.strictEqual(econ.length, 1, 'debe mandarse un econ al reconectar');
        assert.strictEqual(econ[0].carry, 900);
        assert.strictEqual(econ[0].entry, FEE);
    });

    // --- 3: al salir de verdad se liquida UNA vez, con el carry bueno ---
    const cli3 = h.room.clients.get(p.playerId);
    cli3._leaving = true;
    h.host.handleClose(ws2, h.room, p.playerId, null);
    check('tras el rejoin, la salida real liquida una vez con el carry correcto', () => {
        assert.strictEqual(h.leaves.length, 1, 'exactamente una liquidación en todo el ciclo');
        assert.strictEqual(h.leaves[0].carry, 900, 'antes salía 0: el reparto/reembolso se calculaba mal');
        assert.strictEqual(h.leaves[0].payWallet, 'WalletX');
        assert.strictEqual(h.leaves[0].wasAlive, true);
    });
})();

// --- 4: no vuelve → settleParked liquida al expirar la gracia ---
await (async () => {
    const h = makeHost('classic');
    const p = await joinPlaying(h, 'classic');
    p.cli.carry = 700;
    h.host.handleClose(p.ws, h.room, p.playerId, null);
    h.host.settleParked(h.room, p.playerId);
    check('gracia expirada: liquida una vez y vacía el aparcadero', () => {
        assert.strictEqual(h.leaves.length, 1);
        assert.strictEqual(h.leaves[0].carry, 700);
        assert.strictEqual(h.leaves[0].state, 'playing', 'el estado es el de CUANDO se fue (decide el reembolso)');
        assert.strictEqual(h.room.parked.size, 0);
    });
    h.host.settleParked(h.room, p.playerId);
    check('settleParked es idempotente: no paga dos veces', () => {
        assert.strictEqual(h.leaves.length, 1, 'una segunda liquidación duplicaría el pago');
    });
})();

// --- 5: salida voluntaria ({t:'leave'}) → liquidación inmediata ---
await (async () => {
    const h = makeHost('classic');
    const p = await joinPlaying(h, 'classic');
    p.cli.carry = 400;
    h.host.handleInput(h.room, p.playerId, { t: 'leave' });
    h.host.handleClose(p.ws, h.room, p.playerId, null);
    check('leave: liquida al instante, sin aparcar ni dejar cuerpo 30s', () => {
        assert.strictEqual(h.leaves.length, 1, 'el saldo debe verse en el menú al momento');
        assert.strictEqual(h.leaves[0].carry, 400);
        assert.strictEqual(h.room.parked.size, 0);
        assert.strictEqual(h.room.pendingRemovals.get(p.playerId), 0, 'el cuerpo se retira en el siguiente tick');
        assert.strictEqual(h.resumeTokens.size, 0, 'el token muere: ya cobró, no puede volver a su célula');
    });
    const wsX = fakeWs();
    const resX = await h.host.handleJoin(wsX, '1.2.3.4', { t: 'join', resume: p.token });
    check('leave: el token ya no sirve para volver (sería cobrar y seguir jugando)', () => {
        assert.strictEqual(resX, null);
        assert.ok(msgsOf(wsX, 'resumeFail').length === 1);
    });
})();

// --- 6: reinicio de sala con gente aparcada → se les devuelve su carry ---
await (async () => {
    const h = makeHost('arcade');
    const p = await joinPlaying(h, 'arcade');
    p.cli.carry = 250;
    h.host.handleClose(p.ws, h.room, p.playerId, null);
    h.host.restartRoom(h.room);
    check('restartRoom: el aparcado recupera su carry (si no, se esfumaba)', () => {
        assert.strictEqual(h.refunds.length, 1, 'la partida se anula también para él');
        assert.strictEqual(h.refunds[0].amount, 250);
        assert.strictEqual(h.refunds[0].wallet, 'WalletX');
        assert.strictEqual(h.room.parked.size, 0);
    });
})();

console.log(`\n${fail === 0 ? 'OK' : 'FALLOS'}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);

})();
