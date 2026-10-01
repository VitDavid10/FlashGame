/*
 * Cliente del programa pill_staking, en JS plano.
 *
 * Mismo enfoque que treasury-client.js y custody-client.js: lo que hace Anchor por
 * dentro son discriminadores sha256 y Borsh, y su runtime entero no pinta nada en un
 * proceso que corre 24/7.
 *
 *   discriminador de instruccion = sha256("global:<nombre_snake_case>")[0..8]
 *   discriminador de cuenta      = sha256("account:<NombreStruct>")[0..8]
 *
 * CUIDADO AL TOCAR EL PROGRAMA: el orden de las cuentas tiene que ser EXACTAMENTE el
 * del struct #[derive(Accounts)]. Y ojo con Option<Pubkey>, que en Borsh es de
 * LONGITUD VARIABLE —None es 1 byte, Some son 1+32— no los 33 fijos que reserva
 * InitSpace: leerlo fijo desplaza todo lo de detras y los contadores salen a cero sin
 * dar un solo error. Paso en el cliente de la custodia.
 *
 * tests/staking-client.test.js compara todo esto contra el .rs.
 */
'use strict';

const crypto = require('crypto');
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');

const disc = (ns, nombre) => crypto.createHash('sha256').update(`${ns}:${nombre}`).digest().subarray(0, 8);
const ixDisc = (nombre) => disc('global', nombre);
const accDisc = (nombre) => disc('account', nombre);

const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };

const CONFIG_SEED = Buffer.from('config');
const STAKE_SEED = Buffer.from('stake');
const REWARDS_SEED = Buffer.from('rewards');

/** Enfriamiento al salir, en segundos. Tiene que coincidir con el .rs. */
const UNSTAKE_COOLDOWN_SECS = 7 * 86400;
/** Escala del acumulador del programa. */
const PRECISION = 10n ** 12n;

/** Las PDAs del programa. No dependen de nada que cambie entre arranques. */
function pdas(programId) {
    const p = new PublicKey(programId);
    const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], p);
    const [stakeVault] = PublicKey.findProgramAddressSync([STAKE_SEED], p);
    const [rewardVault] = PublicKey.findProgramAddressSync([REWARDS_SEED], p);
    return { config, stakeVault, rewardVault };
}

/** La posicion de una wallet: PDA ["stake", owner]. */
function stakeAccount(programId, owner) {
    const [pda] = PublicKey.findProgramAddressSync(
        [STAKE_SEED, new PublicKey(owner).toBuffer()], new PublicKey(programId));
    return pda;
}

function ix(programId, keys, data) {
    return new TransactionInstruction({ programId: new PublicKey(programId), keys, data });
}
const rw = (pubkey, signer = false) => ({ pubkey: new PublicKey(pubkey), isSigner: signer, isWritable: true });
const ro = (pubkey, signer = false) => ({ pubkey: new PublicKey(pubkey), isSigner: signer, isWritable: false });

/* ===================== INSTRUCCIONES ===================== */

/** Crea config y las dos bovedas. Solo la firma DEPLOYER, compilado en el programa. */
function initialize(programId, { mint, authority, payer }) {
    const { config, stakeVault, rewardVault } = pdas(programId);
    return ix(programId, [
        rw(config), rw(stakeVault), rw(rewardVault), ro(mint), ro(authority), rw(payer, true),
        ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId), ro(SYSVAR_RENT_PUBKEY),
    ], ixDisc('initialize'));
}

/** Mete $PILLY en el pool. El principal sigue siendo del usuario. */
function stake(programId, { from, owner, amountRaw }) {
    const { config, stakeVault } = pdas(programId);
    return ix(programId, [
        rw(config), rw(stakeVault), rw(stakeAccount(programId, owner)), rw(from), rw(owner, true),
        ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId),
    ], Buffer.concat([ixDisc('stake'), u64(amountRaw)]));
}

/** Pide la salida. NO mueve tokens: arranca el enfriamiento de 7 dias. */
function requestUnstake(programId, { owner, amountRaw }) {
    const { config } = pdas(programId);
    return ix(programId, [
        rw(config), rw(stakeAccount(programId, owner)), ro(owner, true),
    ], Buffer.concat([ixDisc('request_unstake'), u64(amountRaw)]));
}

/** Retira lo que ya cumplio el enfriamiento, a la cuenta asociada del dueno. */
function withdrawUnstaked(programId, { owner, mint }) {
    const { config, stakeVault } = pdas(programId);
    const to = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true);
    return ix(programId, [
        rw(config), rw(stakeVault), rw(stakeAccount(programId, owner)), rw(to), ro(mint),
        ro(owner, true), ro(TOKEN_PROGRAM_ID),
    ], ixDisc('withdraw_unstaked'));
}

/** Cobra lo ganado. El principal no se toca. */
function claimRewards(programId, { owner, mint }) {
    const { config, rewardVault } = pdas(programId);
    const to = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true);
    return ix(programId, [
        rw(config), rw(rewardVault), rw(stakeAccount(programId, owner)), rw(to), ro(mint),
        ro(owner, true), ro(TOKEN_PROGRAM_ID),
    ], ixDisc('claim_rewards'));
}

/** Mete lo ganado dentro del principal, sin pasar por la wallet. */
function compound(programId, { owner }) {
    const { config, stakeVault, rewardVault } = pdas(programId);
    return ix(programId, [
        rw(config), rw(rewardVault), rw(stakeVault), rw(stakeAccount(programId, owner)),
        ro(owner, true), ro(TOKEN_PROGRAM_ID),
    ], ixDisc('compound'));
}

/** Llena el pozo y lo reparte a lo largo de `duration` segundos. Solo la autoridad. */
function fundRewards(programId, { from, authority, amountRaw, duration }) {
    const { config, rewardVault } = pdas(programId);
    return ix(programId, [
        rw(config), rw(rewardVault), rw(from), ro(authority, true), ro(TOKEN_PROGRAM_ID),
    ], Buffer.concat([ixDisc('fund_rewards'), u64(amountRaw), i64(duration)]));
}

function transferAuthority(programId, { authority, nueva }) {
    const { config } = pdas(programId);
    return ix(programId, [rw(config), ro(authority, true)],
        Buffer.concat([ixDisc('transfer_authority'), new PublicKey(nueva).toBuffer()]));
}

function acceptAuthority(programId, { nueva }) {
    const { config } = pdas(programId);
    return ix(programId, [rw(config), ro(nueva, true)], ixDisc('accept_authority'));
}

/* ===================== LECTURA ===================== */

/*
 * Option<Pubkey>: None es UN byte, Some son 1+32. InitSpace reserva 33 siempre, pero
 * eso dimensiona la cuenta, no los datos.
 */
function leeOptPubkey(buf, o) {
    if (buf[o] === 1) return { valor: new PublicKey(buf.subarray(o + 1, o + 33)).toBase58(), fin: o + 33 };
    return { valor: null, fin: o + 1 };
}

function decodeConfig(data) {
    const buf = Buffer.from(data);
    if (!buf.subarray(0, 8).equals(accDisc('Config'))) {
        throw new Error('esa cuenta no es una Config de pill_staking');
    }
    let o = 8;
    const pk = () => { const v = new PublicKey(buf.subarray(o, o + 32)).toBase58(); o += 32; return v; };
    const authority = pk();
    const opt = leeOptPubkey(buf, o); o = opt.fin;
    const mint = pk();
    const configBump = buf[o++], stakeBump = buf[o++], rewardsBump = buf[o++];
    const totalStaked = buf.readBigUInt64LE(o); o += 8;
    const accRewardPerShare = buf.readBigUInt64LE(o) + (buf.readBigUInt64LE(o + 8) << 64n); o += 16;
    const rewardRate = buf.readBigUInt64LE(o); o += 8;
    const periodFinish = buf.readBigInt64LE(o); o += 8;
    const lastUpdate = buf.readBigInt64LE(o); o += 8;
    const totalFunded = buf.readBigUInt64LE(o); o += 8;
    const totalPaid = buf.readBigUInt64LE(o); o += 8;
    return {
        authority, pendingAuthority: opt.valor, mint,
        configBump, stakeBump, rewardsBump,
        totalStaked: totalStaked.toString(),
        accRewardPerShare: accRewardPerShare.toString(),
        rewardRate: rewardRate.toString(),
        periodFinish: Number(periodFinish),
        lastUpdate: Number(lastUpdate),
        totalFunded: totalFunded.toString(),
        totalPaid: totalPaid.toString(),
    };
}

function decodeStakeAccount(data) {
    const buf = Buffer.from(data);
    if (!buf.subarray(0, 8).equals(accDisc('StakeAccount'))) {
        throw new Error('esa cuenta no es una StakeAccount de pill_staking');
    }
    let o = 8;
    const owner = new PublicKey(buf.subarray(o, o + 32)).toBase58(); o += 32;
    const amount = buf.readBigUInt64LE(o); o += 8;
    const rewardPerSharePaid = buf.readBigUInt64LE(o) + (buf.readBigUInt64LE(o + 8) << 64n); o += 16;
    const pending = buf.readBigUInt64LE(o); o += 8;
    const unstaking = buf.readBigUInt64LE(o); o += 8;
    const unstakeReadyAt = buf.readBigInt64LE(o); o += 8;
    return {
        owner,
        amount: amount.toString(),
        rewardPerSharePaid: rewardPerSharePaid.toString(),
        pending: pending.toString(),
        unstaking: unstaking.toString(),
        unstakeReadyAt: Number(unstakeReadyAt),
        bump: buf[o],
    };
}

/*
 * Lo que un staker tiene ganado AHORA MISMO, sin mandar transaccion.
 *
 * Rehace la cuenta del programa: adelanta el indice global hasta `now` y aplica la
 * diferencia con el que la cuenta tenia apuntado. Es lo que se ensena en la interfaz
 * entre claim y claim — el programa solo lo actualiza cuando alguien lo llama, asi
 * que leer `pending` a secas daria un numero viejo.
 */
function pendienteAhora(cfg, acc, now = Math.floor(Date.now() / 1000)) {
    let indice = BigInt(cfg.accRewardPerShare);
    const total = BigInt(cfg.totalStaked);
    const hasta = Math.min(now, cfg.periodFinish);
    if (hasta > cfg.lastUpdate && total > 0n && BigInt(cfg.rewardRate) > 0n) {
        indice += (BigInt(hasta - cfg.lastUpdate) * BigInt(cfg.rewardRate) * PRECISION) / total;
    }
    const mio = BigInt(acc.amount);
    const ganado = mio > 0n ? (mio * (indice - BigInt(acc.rewardPerSharePaid))) / PRECISION : 0n;
    return (BigInt(acc.pending) + ganado).toString();
}

/*
 * APR aproximado, en tanto por ciento.
 *
 * Es una proyeccion, no una promesa: extrapola el ritmo de HOY a un anio entero, y
 * ese ritmo cambia con cada aportacion y con cada uno que entra o sale. Si el goteo
 * ya termino, es cero — no queda nada repartiendose.
 */
function aprAprox(cfg, now = Math.floor(Date.now() / 1000)) {
    const total = BigInt(cfg.totalStaked);
    if (total <= 0n || now >= cfg.periodFinish) return 0;
    const alAnio = BigInt(cfg.rewardRate) * 31536000n;
    return Number((alAnio * 10000n) / total) / 100;
}

module.exports = {
    pdas, stakeAccount,
    initialize, stake, requestUnstake, withdrawUnstaked, claimRewards, compound,
    fundRewards, transferAuthority, acceptAuthority,
    decodeConfig, decodeStakeAccount, pendienteAhora, aprAprox,
    ixDisc, accDisc, CONFIG_SEED, STAKE_SEED, REWARDS_SEED,
    UNSTAKE_COOLDOWN_SECS, PRECISION,
};
