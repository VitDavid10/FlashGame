/*
 * Cliente del programa pill_treasury, en JS plano.
 *
 * SIN @coral-xyz/anchor a proposito. El servidor ya arrastra @solana/web3.js y
 * @solana/spl-token; meter el runtime de Anchor solo para formatear instrucciones
 * anadiria un arbol de dependencias enorme a un proceso que corre 24/7 y que ya tuvo
 * su ronda de auditorias (ver la nota de web3.js en el README de vendor). Lo que hace
 * Anchor por dentro son dos cosas simples y aqui estan las dos:
 *
 *   discriminador de instruccion = sha256("global:<nombre_snake_case>")[0..8]
 *   discriminador de cuenta      = sha256("account:<NombreStruct>")[0..8]
 *
 * y detras, los argumentos serializados en Borsh (enteros little-endian, Vec con un
 * u32 de longitud delante, Option con un byte 0/1). Nada mas.
 *
 * CUIDADO AL TOCAR EL PROGRAMA: el orden de las cuentas de cada instruccion tiene que
 * ser EXACTAMENTE el del struct #[derive(Accounts)] correspondiente, y el layout de
 * las cuentas el del #[account]. Si se anade un campo en medio de Config en Rust y no
 * se toca decodeConfig(), este cliente lee basura sin dar error. Los tests de
 * tests/treasury-client.test.js comprueban justo eso contra el .rs.
 */
'use strict';

const crypto = require('crypto');
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } = require('@solana/web3.js');
const {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
} = require('@solana/spl-token');

/* ===================== DISCRIMINADORES ===================== */

const disc = (ns, nombre) => crypto.createHash('sha256').update(`${ns}:${nombre}`).digest().subarray(0, 8);
const ixDisc = (nombre) => disc('global', nombre);
const accDisc = (nombre) => disc('account', nombre);

/* ===================== BORSH MINIMO ===================== */

const u8 = (n) => Buffer.from([n & 0xff]);
const u16le = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64le = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const bool = (v) => Buffer.from([v ? 1 : 0]);
/** Option<T> de Borsh: un byte 0 (None) o 1 (Some) y detras el valor. */
const opt = (v, enc) => (v == null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), enc(v)]));
/** Vec<T>: u32 con la longitud y los elementos seguidos. */
const vec = (arr, enc) => {
    const len = Buffer.alloc(4); len.writeUInt32LE(arr.length);
    return Buffer.concat([len, ...arr.map(enc)]);
};

/* ===================== LECTOR ===================== */

class Cursor {
    constructor(buf, offset = 0) { this.b = buf; this.o = offset; }
    pubkey() { const p = new PublicKey(this.b.subarray(this.o, this.o + 32)); this.o += 32; return p; }
    bytes32() { const v = this.b.subarray(this.o, this.o + 32); this.o += 32; return Buffer.from(v); }
    u64() { const v = this.b.readBigUInt64LE(this.o); this.o += 8; return v; }
    i64() { const v = this.b.readBigInt64LE(this.o); this.o += 8; return Number(v); }
    u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
    u8() { return this.b[this.o++]; }
    bool() { return this.b[this.o++] === 1; }
}

/* ===================== PDAs ===================== */

function pdas(programId) {
    const pid = new PublicKey(programId);
    const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], pid);
    const [custody] = PublicKey.findProgramAddressSync([Buffer.from('custody')], pid);
    const [treasury] = PublicKey.findProgramAddressSync([Buffer.from('treasury')], pid);
    return { programId: pid, config, custody, treasury };
}

function roundPda(programId, epoch) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('round'), u64le(epoch)],
        new PublicKey(programId)
    )[0];
}

function claimPda(programId, epoch, winner) {
    return PublicKey.findProgramAddressSync(
        [Buffer.from('claim'), u64le(epoch), new PublicKey(winner).toBuffer()],
        new PublicKey(programId)
    )[0];
}

/* ===================== DECODIFICADORES ===================== */

const CONFIG_DISC = accDisc('Config');
const ROUND_DISC = accDisc('RewardRound');
const RECEIPT_DISC = accDisc('ClaimReceipt');

function decodeConfig(data) {
    if (!data || data.length < 8 || !data.subarray(0, 8).equals(CONFIG_DISC)) {
        throw new Error('treasury: esa cuenta no es una Config de este programa');
    }
    const c = new Cursor(data, 8);
    return {
        authority: c.pubkey().toBase58(),
        pendingAuthority: c.pubkey().toBase58(),
        mint: c.pubkey().toBase58(),
        unlockTs: c.i64(),
        finalized: c.bool(),
        epochSecs: c.i64(),
        rewardCapPerEpoch: c.u64(),
        rewardBpsPerEpoch: c.u16(),
        challengeSecs: c.i64(),
        sweepCapPerEpoch: c.u64(),
        sweepEpoch: c.i64(),
        sweptThisEpoch: c.u64(),
        burnCapPerEpoch: c.u64(),
        burnEpoch: c.i64(),
        burnedThisEpoch: c.u64(),
        totalBurned: c.u64(),
        reserved: c.u64(),
        totalDeposited: c.u64(),
        totalWithdrawn: c.u64(),
        totalFunded: c.u64(),
        totalSwept: c.u64(),
        totalRewarded: c.u64(),
        totalExpired: c.u64(),
        roundsPublished: c.u64(),
        configBump: c.u8(),
        custodyBump: c.u8(),
        treasuryBump: c.u8(),
    };
}

function decodeRound(data) {
    if (!data || data.length < 8 || !data.subarray(0, 8).equals(ROUND_DISC)) {
        throw new Error('treasury: esa cuenta no es una RewardRound de este programa');
    }
    const c = new Cursor(data, 8);
    return {
        epoch: c.u64(),
        merkleRoot: c.bytes32().toString('hex'),
        total: c.u64(),
        claimed: c.u64(),
        winners: c.u16(),
        publishedAt: c.i64(),
        claimableAt: c.i64(),
        cancelled: c.bool(),
        expired: c.bool(),
        bump: c.u8(),
    };
}

function decodeReceipt(data) {
    if (!data || data.length < 8 || !data.subarray(0, 8).equals(RECEIPT_DISC)) {
        throw new Error('treasury: esa cuenta no es un ClaimReceipt de este programa');
    }
    const c = new Cursor(data, 8);
    return { amount: c.u64(), ts: c.i64(), bump: c.u8() };
}

/* ===================== INSTRUCCIONES ===================== */

const rw = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const ro = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });

function ix(programId, keys, data) {
    return new TransactionInstruction({ programId: new PublicKey(programId), keys, data });
}

/**
 * initialize — crea config y los dos vaults. Una vez en la vida del programa.
 * `unlockTs` corto (30 dias) para la fase de calibracion; se alarga con extendLock.
 */
function initialize(programId, { mint, authority, payer, args }) {
    const p = pdas(programId);
    const data = Buffer.concat([
        ixDisc('initialize'),
        i64le(args.unlockTs),
        i64le(args.epochSecs),
        u64le(args.rewardCapPerEpoch),
        u16le(args.rewardBpsPerEpoch),
        i64le(args.challengeSecs),
        u64le(args.sweepCapPerEpoch),
        u64le(args.burnCapPerEpoch),
    ]);
    return ix(programId, [
        rw(p.config), rw(p.custody), rw(p.treasury),
        ro(new PublicKey(mint)), ro(new PublicKey(authority)), rw(new PublicKey(payer), true),
        ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId), ro(SYSVAR_RENT_PUBKEY),
    ], data);
}

/** deposit — el jugador mete PILL en CUSTODY. Lo firma el jugador. */
function deposit(programId, { from, owner, amountRaw }) {
    const p = pdas(programId);
    return ix(programId, [
        rw(p.config), rw(p.custody), rw(new PublicKey(from)), ro(new PublicKey(owner), true),
        ro(TOKEN_PROGRAM_ID),
    ], Buffer.concat([ixDisc('deposit'), u64le(amountRaw)]));
}

/** fund — cualquiera aporta a la TESORERIA. Sin retorno: queda bloqueado. */
function fund(programId, { from, owner, amountRaw }) {
    const p = pdas(programId);
    return ix(programId, [
        rw(p.config), rw(p.treasury), rw(new PublicKey(from)), ro(new PublicKey(owner), true),
        ro(TOKEN_PROGRAM_ID),
    ], Buffer.concat([ixDisc('fund'), u64le(amountRaw)]));
}

/**
 * withdraw — CUSTODY -> la ATA del jugador. DOS FIRMAS: la autoridad y el jugador.
 *
 * La autoridad dice cuanto (el saldo es off-chain), el jugador dice que es el. El
 * destino ya no es un parametro: se deriva de , asi que la clave del servidor
 * sola no puede mandar el dinero a una direccion cualquiera.
 */
function withdraw(programId, { player, authority, mint, amountRaw }) {
    const p = pdas(programId);
    const w = new PublicKey(player);
    const m = new PublicKey(mint);
    return ix(programId, [
        rw(p.config), rw(p.custody), ro(p.treasury),
        rw(getAssociatedTokenAddressSync(m, w, true)),
        ro(m),
        ro(w, true),
        ro(new PublicKey(authority), true),
        ro(TOKEN_PROGRAM_ID),
    ], Buffer.concat([ixDisc('withdraw'), u64le(amountRaw)]));
}

/** sweep — CUSTODY -> TREASURY. Capado por epoca. Es el camino del rake y la tienda. */
function sweep(programId, { authority, amountRaw }) {
    const p = pdas(programId);
    return ix(programId, [
        rw(p.config), rw(p.custody), rw(p.treasury), ro(new PublicKey(authority), true),
        ro(TOKEN_PROGRAM_ID),
    ], Buffer.concat([ixDisc('sweep'), u64le(amountRaw)]));
}

/**
 * burn — quema PILL de la CUSTODIA. Baja el supply; no va a ninguna cartera.
 *
 * Es la otra salida de lo que la tienda de skins recauda: el jugador ya gasto ese
 * PILL, asi que tiene que salir de la custodia o esta acabaria respaldando saldos
 * que ya nadie tiene. El mint va como cuenta mutable porque el supply vive ahi.
 */
function burn(programId, { authority, mint, amountRaw }) {
    const p = pdas(programId);
    return ix(programId, [
        rw(p.config), rw(p.custody), rw(new PublicKey(mint)),
        ro(new PublicKey(authority), true), ro(TOKEN_PROGRAM_ID),
    ], Buffer.concat([ixDisc('burn'), u64le(amountRaw)]));
}

/** publishRound — anota la raiz y arranca la ventana de impugnacion. No mueve tokens. */
function publishRound(programId, { epoch, merkleRoot, totalRaw, winners, authority }) {
    const p = pdas(programId);
    const raiz = Buffer.isBuffer(merkleRoot) ? merkleRoot : Buffer.from(merkleRoot, 'hex');
    if (raiz.length !== 32) throw new Error('treasury: la raiz tiene que ser de 32 bytes');
    return ix(programId, [
        rw(p.config), rw(roundPda(programId, epoch)), ro(p.treasury),
        rw(new PublicKey(authority), true), ro(SystemProgram.programId),
    ], Buffer.concat([ixDisc('publish_round'), u64le(epoch), raiz, u64le(totalRaw), u16le(winners)]));
}

/** cancelRound — solo DENTRO de la ventana. Despues, imposible. */
function cancelRound(programId, { epoch, authority }) {
    const p = pdas(programId);
    return ix(programId, [
        rw(p.config), rw(roundPda(programId, epoch)), ro(new PublicKey(authority), true),
    ], ixDisc('cancel_round'));
}

/**
 * claim — la unica salida del treasury antes de unlock_ts.
 *
 * `winner` NO firma: su direccion viene de la hoja del Merkle. `payer` es quien paga
 * el gas, y puede ser cualquiera — incluido un tercero reclamando por el ganador.
 */
function claim(programId, { epoch, winner, amountRaw, proof, mint, payer }) {
    const p = pdas(programId);
    const w = new PublicKey(winner);
    const m = new PublicKey(mint);
    const nodos = proof.map(n => (Buffer.isBuffer(n) ? n : Buffer.from(n, 'hex')));
    for (const n of nodos) if (n.length !== 32) throw new Error('treasury: nodo de prueba con longitud rara');
    return ix(programId, [
        rw(p.config), rw(roundPda(programId, epoch)), rw(p.treasury),
        ro(w),
        rw(getAssociatedTokenAddressSync(m, w, true)),
        ro(m),
        rw(claimPda(programId, epoch, w)),
        rw(new PublicKey(payer), true),
        ro(TOKEN_PROGRAM_ID), ro(ASSOCIATED_TOKEN_PROGRAM_ID), ro(SystemProgram.programId),
    ], Buffer.concat([
        ixDisc('claim'), u64le(epoch), u64le(amountRaw), vec(nodos, (n) => n),
    ]));
}

/** expireRound — libera lo no reclamado de una ronda vieja. La puede llamar cualquiera. */
function expireRound(programId, { epoch, caller }) {
    const p = pdas(programId);
    return ix(programId, [
        rw(p.config), rw(roundPda(programId, epoch)), ro(new PublicKey(caller), true),
    ], ixDisc('expire_round'));
}

/** extendLock — alarga el bloqueo. Nunca lo acorta. */
function extendLock(programId, { newUnlockTs, authority }) {
    const p = pdas(programId);
    return ix(programId, [rw(p.config), ro(new PublicKey(authority), true)],
        Buffer.concat([ixDisc('extend_lock'), i64le(newUnlockTs)]));
}

/** tighten — endurece los limites. Los `null` se dejan como estan. */
function tighten(programId, { authority, rewardCapPerEpoch = null, rewardBpsPerEpoch = null, sweepCapPerEpoch = null, burnCapPerEpoch = null, challengeSecs = null }) {
    const p = pdas(programId);
    return ix(programId, [rw(p.config), ro(new PublicKey(authority), true)], Buffer.concat([
        ixDisc('tighten'),
        opt(rewardCapPerEpoch, u64le),
        opt(rewardBpsPerEpoch, u16le),
        opt(sweepCapPerEpoch, u64le),
        opt(burnCapPerEpoch, u64le),
        opt(challengeSecs, i64le),
    ]));
}

/** finalize — congela los parametros para siempre. */
function finalize(programId, { authority }) {
    const p = pdas(programId);
    return ix(programId, [rw(p.config), ro(new PublicKey(authority), true)], ixDisc('finalize'));
}

function transferAuthority(programId, { nueva, authority }) {
    const p = pdas(programId);
    return ix(programId, [rw(p.config), ro(new PublicKey(authority), true)],
        Buffer.concat([ixDisc('transfer_authority'), new PublicKey(nueva).toBuffer()]));
}

function acceptAuthority(programId, { newAuthority }) {
    const p = pdas(programId);
    return ix(programId, [rw(p.config), ro(new PublicKey(newAuthority), true)], ixDisc('accept_authority'));
}

/** unlockWithdraw — TREASURY -> donde sea. Cerrada hasta unlock_ts. */
function unlockWithdraw(programId, { to, authority, amountRaw }) {
    const p = pdas(programId);
    return ix(programId, [
        rw(p.config), rw(p.treasury), rw(new PublicKey(to)),
        ro(new PublicKey(authority), true), ro(TOKEN_PROGRAM_ID),
    ], Buffer.concat([ixDisc('unlock_withdraw'), u64le(amountRaw)]));
}

module.exports = {
    pdas, roundPda, claimPda,
    decodeConfig, decodeRound, decodeReceipt,
    initialize, deposit, fund, withdraw, sweep, burn,
    publishRound, cancelRound, claim, expireRound,
    extendLock, tighten, finalize, transferAuthority, acceptAuthority, unlockWithdraw,
    // Se exportan para los tests: son el contrato de compatibilidad con el .rs.
    _internals: { ixDisc, accDisc, u64le, i64le, u16le, opt, vec, Cursor },
};
