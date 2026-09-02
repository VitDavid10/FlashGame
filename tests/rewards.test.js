/*
 * Tests del orquestador de premios: el paso de "el dia se cerro" a "este jugador
 * tiene una prueba de Merkle con la que cobrar".
 *
 * Todo esto corre SIN cadena. Es a proposito: el pipeline entero —cierre, reparto,
 * arbol, JSON publico, pantalla de claims— tiene que funcionar y ser testeable antes
 * de que exista el contrato en devnet, y tiene que seguir generando rondas cuando el
 * RPC este caido.
 *
 *   node --test "tests/*.test.js"
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Keypair } = require('@solana/web3.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-rw-'));
process.env.LB_DIR = TMP;
process.env.REWARD_BUDGET_PILL = '50000';
delete process.env.TREASURY_PROGRAM;

const lb = require('../server/leaderboard.js');
const rewards = require('../server/rewards.js');
const merkle = require('../server/merkle.js');

const wallets = Array.from({ length: 12 }, () => Keypair.generate().publicKey.toBase58());
const FECHA = '2026-05-04';

test('la epoca de un dia es el numero de dias desde el epoch Unix', () => {
    assert.equal(rewards.epochDeFecha('1970-01-01'), 0);
    assert.equal(rewards.epochDeFecha('1970-01-02'), 1);
    assert.equal(rewards.fechaDeEpoch(rewards.epochDeFecha(FECHA)), FECHA);
    // Es la misma cuenta que hace el contrato con Clock: floor(ts / 86400).
    const ts = Date.UTC(2026, 4, 4) / 1000;
    assert.equal(rewards.epochDeFecha(FECHA), Math.floor(ts / 86400));
});

test('preparar una ronda de un dia cerrado saca reparto, arbol y JSON publico', () => {
    wallets.forEach((w, i) => {
        for (let k = 0; k < 60 - i * 4; k++) lb.recordKill(w, 'jugador' + i);
        lb.recordPeak(w, 50000 - i * 100, 'jugador' + i);
    });
    lb._setFecha(FECHA);
    const snap = lb.cerrarAhora();
    assert.equal(snap.entries.length, 12);

    const presupuesto = rewards.pillToRaw(50000);
    const r = rewards.prepararRonda(FECHA, presupuesto);
    assert.ok(r, 'deberia haber salido una ronda');
    assert.equal(r.winners, 10, 'solo cobran diez aunque haya doce en la lista');
    assert.equal(r.date, FECHA);
    assert.equal(r.leaderboardHash, snap.hash, 'la ronda tiene que apuntar al dia del que sale');
    assert.equal(r.sig, null, 'sin cadena configurada no se publica');

    const pub = rewards.rondaPublica(r.epoch);
    assert.ok(pub, 'falta el JSON publico');
    assert.equal(pub.root, r.root);
    assert.equal(pub.leaderboardHash, snap.hash);
    assert.equal(pub.entries.length, 10);
});

test('el JSON publico es auditable: la raiz sale de la lista publicada', () => {
    // Esto es lo que haria un tercero: bajarse el JSON, quedarse con {wallet, amount}
    // y comprobar que da la misma raiz que se publico on-chain.
    const epoch = rewards.epochDeFecha(FECHA);
    const pub = rewards.rondaPublica(epoch);
    const soloDatos = pub.entries.map(e => ({ wallet: e.wallet, amountRaw: BigInt(e.amountRaw) }));
    assert.equal(merkle.buildTree(epoch, soloDatos).rootHex, pub.root);
    // Y el total anunciado cuadra con la suma de la lista.
    const suma = soloDatos.reduce((s, e) => s + e.amountRaw, 0n);
    assert.equal(pub.total, suma.toString());
});

test('preparar dos veces el mismo dia no duplica la ronda', () => {
    const antes = rewards.estado().total;
    assert.equal(rewards.prepararRonda(FECHA, rewards.pillToRaw(50000)), null);
    assert.equal(rewards.estado().total, antes);
});

test('un dia sin nadie por encima del minimo no genera ronda', () => {
    lb._setFecha('2026-05-05');
    lb.cerrarAhora();
    assert.equal(rewards.prepararRonda('2026-05-05', rewards.pillToRaw(50000)), null);
});

test('presupuesto cero no genera ronda (mejor nada que una ronda vacia)', () => {
    wallets.forEach((w, i) => { for (let k = 0; k < 10; k++) lb.recordKill(w, 'j' + i); });
    lb._setFecha('2026-05-06');
    lb.cerrarAhora();
    assert.equal(rewards.prepararRonda('2026-05-06', 0n), null);
});

test('el ganador recibe su prueba y valida contra la raiz publicada', () => {
    const epoch = rewards.epochDeFecha(FECHA);
    const pub = rewards.rondaPublica(epoch);
    const primero = pub.entries[0];

    const mios = rewards.premiosDe(primero.wallet);
    assert.equal(mios.pendientes.length, 1);
    const premio = mios.pendientes[0];
    assert.equal(premio.epoch, epoch);
    assert.equal(premio.rank, 1);
    assert.equal(premio.amountRaw, primero.amountRaw);
    assert.equal(premio.claimable, false, 'sin publicar on-chain no se puede reclamar');

    const root = Buffer.from(pub.root, 'hex');
    const leaf = merkle.leafHash(epoch, premio.wallet, BigInt(premio.amountRaw));
    assert.ok(merkle.verifyProof(premio.proof.map(h => Buffer.from(h, 'hex')), root, leaf));
});

test('quien no salio en la lista no tiene nada que reclamar', () => {
    const forastero = Keypair.generate().publicKey.toBase58();
    assert.equal(rewards.premiosDe(forastero).pendientes.length, 0);
    assert.equal(rewards.premiosDe(null).pendientes.length, 0);
    // El puesto 11 tampoco: hay pesos para diez.
    const undecimo = wallets[10];
    assert.equal(rewards.premiosDe(undecimo).pendientes.length, 0);
});

test('un premio ya cobrado desaparece de los pendientes', () => {
    const epoch = rewards.epochDeFecha(FECHA);
    const pub = rewards.rondaPublica(epoch);
    const w = pub.entries[1].wallet;
    assert.equal(rewards.premiosDe(w).pendientes.length, 1);
    rewards.marcarCobrado(epoch, w, 'firma-de-prueba');
    assert.equal(rewards.premiosDe(w).pendientes.length, 0);
});

test('el reparto respeta los pesos: el #1 se lleva 35 veces mas que... 35/1.5 que el #10', () => {
    const pub = rewards.rondaPublica(rewards.epochDeFecha(FECHA));
    const primero = BigInt(pub.entries[0].amountRaw);
    const decimo = BigInt(pub.entries[9].amountRaw);
    // 35 % y 1,5 %: la proporcion es 70/3.
    assert.equal(primero * 3n, decimo * 70n);
});

test('sin programa configurado, publicar avisa en vez de reventar', async () => {
    const epoch = rewards.epochDeFecha(FECHA);
    const solanaFalso = { canWithdraw: () => true, authorityPubkey: () => Keypair.generate().publicKey.toBase58(), sendInstructions: async () => 'sig' };
    const r = await rewards.publicarRonda({ epoch, root: '00'.repeat(32), totalRaw: '1', winners: 1 }, solanaFalso, null);
    assert.equal(r.ok, false);
    assert.match(r.error, /sin programa/);
});

test('el estado resume las rondas para el panel', () => {
    const e = rewards.estado();
    assert.equal(e.programa, null);
    assert.ok(e.total >= 1);
    assert.equal(e.sinPublicar, e.total, 'sin cadena, ninguna esta publicada');
    const r = e.rondas.find(x => x.date === FECHA);
    assert.ok(r);
    assert.equal(r.winners, 10);
    assert.equal(r.pill, 50000 - 0, 'el reparto entero del presupuesto (los pesos suman 100 %)');
});

test('limpieza', () => {
    rewards.save(); lb.save();
    fs.rmSync(TMP, { recursive: true, force: true });
    assert.ok(!fs.existsSync(TMP));
});
