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
function playingRoom(mode, sim, clients, parked) {
    return {
        key: mode + '_5$_L1', comboKey: mode + '_5$', mode, roomName: '5$',
        state: 'playing', clients: new Map(clients), sim, pot: 0,
        pendingRemovals: new Map(), parked: new Map(parked || []), deadRemovals: new Map(), spectators: new Set(),
        tickCount: 0, lastTick: Date.now() - 25, endsAt: null, emptySince: 0, pillRate: 10000,
    };
}
// Payload de un desconectado en ventana de rejoin (lo que guarda parkPlayer en
// game-host.js): mismos campos económicos que un cliente, pero sin ws.
function parkedCli(carry, payWallet, extra) {
    return Object.assign({ name: 'Gone', isTester: false, carry, payWallet: payWallet || null, paidFee: 0, entryFee: 500, cid: null, state: 'playing' }, extra || {});
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

// --- Escenario 5: arcade sin ninguna muerte → el carry de los vivos igual reparte el pot ---
check('arcade fin sin muertes: carry de los vivos entra al pot y se reparte', () => {
    const econ = spyEcon();
    const A = { id: 'A', name: 'Alive1', peakMass: 300, cells: [{ mass: 300 }], alive: true, matchSkillUses: 0 };
    const B = { id: 'B', name: 'Alive2', peakMass: 200, cells: [{ mass: 200 }], alive: true, matchSkillUses: 0 };
    const sim = mockSim([A, B], []);
    const cliA = { ws: ws(), carry: 100, payWallet: 'WalletA', cid: null, name: 'Alive1' };
    const cliB = { ws: ws(), carry: 100, payWallet: 'WalletB', cid: null, name: 'Alive2' };
    const room = playingRoom('arcade', sim, [['A', cliA], ['B', cliB]]);
    room.endsAt = Date.now() - 1; // fuerza fin de partida ya alcanzado
    tickRoomOnce(room, Date.now(), baseCtx(econ));
    assert.strictEqual(cliA.carry, 0, 'carry del vivo A debe vaciarse al pot');
    assert.strictEqual(cliB.carry, 0, 'carry del vivo B debe vaciarse al pot');
    assert.strictEqual(room.pot, 0, 'el pot se resetea tras el reparto');
    const credits = econ.calls.filter(c => c[0] === 'credit');
    assert.strictEqual(credits.length, 2, 'debe repartirse a ambos jugadores vivos (pot=200)');
    const totalCredited = credits.reduce((s, c) => s + c[2], 0);
    assert.ok(totalCredited > 0, 'el reparto debe ser > 0 aunque nadie murió');
    assert.ok(cliA.ws.sent.some(m => JSON.parse(m).t === 'prize'), 'debe emitirse el evento prize a los jugadores');
});

// --- Escenario 6: pentakills de sala (panel admin) — cuenta SOLO al llegar a 5 ---
check('classic pentakills: room.pentas cuenta streak===5, no recuenta 6+, arcade no cuenta', () => {
    const econ = spyEcon();
    const K = { id: 'K', name: 'Killer', peakMass: 0, cells: [], alive: true, matchSkillUses: 0 };
    const sim = mockSim([K], [
        { type: 'botKilled', playerId: 'K', streak: 4, victimId: null },
        { type: 'botKilled', playerId: 'K', streak: 5, victimId: null },
        { type: 'botKilled', playerId: 'K', streak: 6, victimId: null },
    ]);
    const cliK = { ws: ws(), carry: 0, payWallet: null, cid: null, name: 'Killer' };
    const room = playingRoom('classic', sim, [['K', cliK]]);
    tickRoomOnce(room, Date.now(), baseCtx(econ));
    assert.strictEqual(room.pentas, 1, 'una racha 4→5→6 debe contar UN pentakill');
    // segunda racha del mismo jugador (murió y volvió a 5): cuenta otro
    sim.players.get('K'); // sigue en la sala
    const sim2events = [{ type: 'botKilled', playerId: 'K', streak: 5, victimId: null }];
    room.sim = mockSim([K], sim2events);
    room.lastTick = Date.now() - 25;
    tickRoomOnce(room, Date.now(), baseCtx(econ));
    assert.strictEqual(room.pentas, 2, 'otra racha que llega a 5 debe sumar otro pentakill');
    // arcade: streak 5 no toca pentas
    const roomA = playingRoom('arcade', mockSim([K], [{ type: 'botKilled', playerId: 'K', streak: 5, victimId: null }]), [['K', cliK]]);
    tickRoomOnce(roomA, Date.now(), baseCtx(econ));
    assert.strictEqual(roomA.pentas | 0, 0, 'arcade no cuenta pentakills');
});

// ===================================================================
// Desconectados en ventana de rejoin (room.parked). Su dinero sigue EN JUEGO
// mientras su célula viva: si les comen lo pierden, si matan lo ganan. Antes no
// estaban en room.clients y el tick los trataba como bots, así que su carry se
// destruía y el matador cobraba una entrada virtual creada de la nada.
// ===================================================================

// --- Escenario 7: classic, matar a un APARCADO → el matador se lleva SU carry ---
check('classic: víctima aparcada → el matador cobra su carry, no la entrada virtual', () => {
    const econ = spyEcon();
    const K = { id: 'K', name: 'Killer', peakMass: 0, cells: [], alive: true, matchSkillUses: 0 };
    const sim = mockSim([K], [{ type: 'botKilled', playerId: 'K', streak: 1, victimId: 'GONE' }]);
    const cliK = { ws: ws(), carry: 0, payWallet: 'WalletK', cid: null, name: 'Killer' };
    const pk = parkedCli(700, 'WalletGone');
    const room = playingRoom('classic', sim, [['K', cliK]], [['GONE', pk]]);
    tickRoomOnce(room, Date.now(), baseCtx(econ));
    assert.strictEqual(cliK.carry, 700, 'el matador debe llevarse el carry del aparcado (700), no el fee virtual (100)');
    assert.strictEqual(pk.carry, 0, 'el aparcado se queda a 0: ya no puede cobrarlo al expirar la gracia');
});

// --- Escenario 8: arcade, muere un APARCADO → su carry va al bote ---
check('arcade: muere un aparcado → su carry al bote (no la entrada virtual)', () => {
    const econ = spyEcon();
    const D = { id: 'GONE', name: 'Gone', peakMass: 900, cells: [], alive: false, matchSkillUses: 0 };
    const A = { id: 'A', name: 'Alive', peakMass: 50, cells: [{ mass: 50 }], alive: true, matchSkillUses: 0 };
    const sim = mockSim([D, A], [{ type: 'playerDied', playerId: 'GONE' }]);
    const pk = parkedCli(300, 'WalletGone');
    // Hace falta alguien conectado: una sala con clients vacío no simula (early return).
    const room = playingRoom('arcade', sim, [['A', { ws: ws(), carry: 0, payWallet: null, cid: null, name: 'Alive' }]], [['GONE', pk]]);
    tickRoomOnce(room, Date.now(), baseCtx(econ));
    assert.strictEqual(room.pot, 300, 'el carry del aparcado va al bote (300), no la entrada virtual (100)');
    assert.strictEqual(pk.carry, 0, 'el carry del aparcado se vacía');
});

// --- Escenario 9: gracia expirada → se liquida ANTES de borrarlo de la sim ---
check('gracia expirada: settleParked se llama antes de removePlayer', () => {
    const econ = spyEcon();
    const D = { id: 'GONE', name: 'Gone', peakMass: 10, cells: [], alive: true, matchSkillUses: 0 };
    const sim = mockSim([D], []);
    const orden = [];
    sim.removePlayer = (pid) => orden.push('remove:' + pid);
    const room = playingRoom('classic', sim, [], [['GONE', parkedCli(500, 'WalletGone')]]);
    room.pendingRemovals.set('GONE', Date.now() - 1);   // gracia ya vencida
    const ctx = baseCtx(econ);
    ctx.settleParked = (r, pid) => orden.push('settle:' + pid);
    tickRoomOnce(room, Date.now(), ctx);
    assert.deepStrictEqual(orden, ['settle:GONE', 'remove:GONE'], 'hay que liquidar mientras la célula sigue en la sim (de ahí salen wasAlive/kills/peak)');
    assert.ok(!room.pendingRemovals.has('GONE'), 'la gracia vencida se limpia');
});

// --- Escenario 10: fin de arcade → el aparcado aporta al bote y cobra si queda en el TOP ---
check('arcade fin: el aparcado aporta su carry al bote y cobra su parte del reparto', () => {
    const econ = spyEcon();
    const G = { id: 'GONE', name: 'Gone', peakMass: 5000, cells: [], alive: true, matchSkillUses: 0 };
    const A = { id: 'A', name: 'Alive', peakMass: 100, cells: [{ mass: 100 }], alive: true, matchSkillUses: 0 };
    const sim = mockSim([G, A], []);
    const cliA = { ws: ws(), carry: 100, payWallet: 'WalletA', cid: null, name: 'Alive' };
    const pk = parkedCli(400, 'WalletGone');
    const room = playingRoom('arcade', sim, [['A', cliA]], [['GONE', pk]]);
    room.endsAt = Date.now() - 1;
    tickRoomOnce(room, Date.now(), baseCtx(econ));
    assert.strictEqual(pk.carry, 0, 'el carry del aparcado entra al bote en vez de quemarse');
    const credits = econ.calls.filter(c => c[0] === 'credit');
    const suyo = credits.find(c => c[1] === 'WalletGone');
    assert.ok(suyo, 'el aparcado con más masa debe cobrar del bote (bote=500, #1=35%)');
    assert.strictEqual(suyo[2], 175, 'el #1 se lleva el 35% de 500');
});

console.log(`\n${fail === 0 ? 'OK' : 'FALLOS'}: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
