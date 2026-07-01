'use strict';
// Test de integración 4a.3: corre el tick real (tickRoomOnce) con un econ espía
// y verifica que la contabilidad de partida (carry local del Host) y los eventos
// económicos hacia el Director (econ.*) se comportan igual que antes del refactor.
const assert = require('assert');
const { tickRoomOnce } = require('../room-loop.js');

let pass = 0, fail = 0;
function check(name, fn) { try { fn(); pass++; console.log('  PASS', name); } catch (e) { fail++; console.log('  FAIL', name, '→', e.message); } }

// --- Dobles de prueba ---
function spyEcon() {
    const calls = [];
    const rec = (m) => (...a) => calls.push([m, ...a]);
    return {
        calls,
        credit: rec('credit'), playerDeath: rec('playerDeath'), botKill: rec('botKill'),
        peakMassFlush: rec('peakMassFlush'), dailyEvent: rec('dailyEvent'),
        questOnlineMatch: rec('questOnlineMatch'), questFinishArcade: rec('questFinishArcade'),
        questBestMass: rec('questBestMass'), questSkills: rec('questSkills'),
    };
}
const ws = () => ({ readyState: 1, sent: [], send(m) { this.sent.push(m); } });
function baseCtx(econ) {
    return {
        econ, resumeTokens: new Map(), flags: {},
        EMPTY_RESET_MS: 1e9, EMPTY_ROOM_TTL: 1e9, DEAD_REMOVE_MS: 3000,
        ARCADE_KEEP_MIN: 5, ARCADE_SHORTEN_MS: 30000, arcadeRestartMs: 10000,
        snapshotEvery: 1000, aoiEnabled: false,
        log() {}, logAdmin() {}, broadcast() {}, restartRoom() {}, startMatch() {},
        tickGradualBots() {}, deleteRoom() {}, minRealOf: () => 1, sendEcon() {},
        addToPot: (room, amt) => { if (amt > 0) room.pot = (room.pot || 0) + amt; },
        entryFeePill: () => 100,
        buildSnapshotFor: () => ({ t: 'snap' }), aoiBoxFor: () => null,
        proto: { encodeSnap: () => new ArrayBuffer(0) },
    };
}
// sim mínimo: drena una tanda de eventos y expone players/enemies.
function mockSim(players, events) {
    return {
        now: 0, enemies: [], foods: [], viruses: [], ejectedMasses: [], projectiles: [],
        players: new Map(players.map(p => [p.id, p])),
        step() {}, removePlayer() {},
        drainEvents() { const e = events.slice(); events.length = 0; return e; },
    };
}
function playingRoom(mode, sim, clients) {
    return {
        key: mode + '_5$_L1', comboKey: mode + '_5$', mode, roomName: '5$',
        state: 'playing', clients: new Map(clients), sim, pot: 0,
        pendingRemovals: new Map(), deadRemovals: new Map(), spectators: new Set(),
        tickCount: 0, lastTick: Date.now() - 25, endsAt: null, emptySince: 0, pillRate: 10000,
    };
}

// --- Escenario 1: classic, matar bot → carry sube y econ.botKill emitido ---
check('classic botKilled: carry += fee, econ.botKill emitido', () => {
    const econ = spyEcon();
    const K = { id: 'K', name: 'Killer', peakMass: 0, cells: [], alive: true, matchSkillUses: 0 };
    const sim = mockSim([K], [{ type: 'botKilled', playerId: 'K', streak: 1, victimId: null }]);
    const cliK = { ws: ws(), carry: 0, payWallet: null, cid: null, name: 'Killer' };
    const room = playingRoom('classic', sim, [['K', cliK]]);
    tickRoomOnce(room, Date.now(), baseCtx(econ));
    assert.strictEqual(cliK.carry, 100, 'carry debería subir por la kill de bot');
    assert.ok(econ.calls.find(c => c[0] === 'botKill' && c[1] === 'Killer'), 'falta econ.botKill');
    assert.ok(!econ.calls.find(c => c[0] === 'credit'), 'no debe haber credit sin 5 kills');
});

// --- Escenario 2: classic, 5ª kill con wallet → econ.credit del carry completo ---
check('classic victoria (streak 5): econ.credit(wallet, carry) y carry=0', () => {
    const econ = spyEcon();
    const K = { id: 'K', name: 'Killer', peakMass: 0, cells: [], alive: true, matchSkillUses: 0 };
    const sim = mockSim([K], [{ type: 'botKilled', playerId: 'K', streak: 5, victimId: null }]);
    const cliK = { ws: ws(), carry: 500, payWallet: 'WalletABC', cid: null, name: 'Killer' };
    const room = playingRoom('classic', sim, [['K', cliK]]);
    tickRoomOnce(room, Date.now(), baseCtx(econ));
    const credit = econ.calls.find(c => c[0] === 'credit');
    assert.ok(credit, 'falta econ.credit en la victoria');
    assert.strictEqual(credit[1], 'WalletABC');
    assert.strictEqual(credit[2], 600, 'debe acreditar carry(500)+fee(100)=600');
    assert.strictEqual(cliK.carry, 0, 'carry se vacía tras el cashout de victoria');
});

// --- Escenario 3: arcade, muerte → entrada al pot y econ.playerDeath/peakMassFlush ---
check('arcade playerDied: carry del muerto va al pot, econ.playerDeath emitido', () => {
    const econ = spyEcon();
    const D = { id: 'D', name: 'Dead', peakMass: 1234, cells: [], alive: false, matchSkillUses: 0 };
    const sim = mockSim([D], [{ type: 'playerDied', playerId: 'D' }]);
    const cliD = { ws: ws(), carry: 200, payWallet: 'W', cid: null, name: 'Dead', isTester: false };
    const room = playingRoom('arcade', sim, [['D', cliD]]);
    tickRoomOnce(room, Date.now(), baseCtx(econ));
    assert.strictEqual(room.pot, 200, 'el carry del muerto debe ir al pot en arcade');
    assert.strictEqual(cliD.carry, 0, 'carry del muerto se vacía');
    assert.ok(econ.calls.find(c => c[0] === 'playerDeath' && c[1] === 'arcade_5$'), 'falta econ.playerDeath');
    assert.ok(econ.calls.find(c => c[0] === 'peakMassFlush'), 'falta econ.peakMassFlush');
});

// --- Escenario 4: tester no ensucia stats reales (econ.playerDeath con tester=true) ---
check('tester: econ.playerDeath recibe tester=true', () => {
    const econ = spyEcon();
    const D = { id: 'D', name: 'Bot', peakMass: 0, cells: [], alive: false, matchSkillUses: 0 };
    const sim = mockSim([D], [{ type: 'playerDied', playerId: 'D' }]);
    const cliD = { ws: ws(), carry: 0, payWallet: null, cid: null, name: 'Bot', isTester: true };
    const room = playingRoom('classic', sim, [['D', cliD]]);
    tickRoomOnce(room, Date.now(), baseCtx(econ));
    const pd = econ.calls.find(c => c[0] === 'playerDeath');
    assert.ok(pd && pd[2] === true, 'econ.playerDeath debe marcar tester=true');
});

console.log(`\n${fail === 0 ? 'OK' : 'FALLOS'}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
