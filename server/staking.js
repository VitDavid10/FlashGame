/*
 * QUÉ PROGRAMA LLEVA EL STAKING. Un solo sitio donde se decide.
 *
 * Hay dos implementaciones vivas del mismo staking:
 *
 *   pill_staking   contrato aparte (STAKING_PROGRAM). Es el camino nuevo: se puede
 *                  desplegar suelto, sin pagar la tesorería entera.
 *   pill_treasury  el staking metido dentro de la tesorería (TREASURY_PROGRAM). Es
 *                  lo que había antes, y lo que sigue funcionando donde ya está
 *                  desplegado.
 *
 * Este módulo las normaliza a la misma forma para que el resto del servidor no sepa
 * cuál está detrás. Sin esto, cambiar de contrato obligaría a tocar el endpoint de
 * staking, el barrido del rake, la tienda y el panel — y a acordarse de los cuatro.
 *
 * El orden importa: si están las dos, manda el contrato aparte. Al desplegarlo se
 * pone su variable y el servidor se pasa solo; el de la tesorería se queda para lo
 * que ya tuviera dentro.
 */
'use strict';

const tc = require('./treasury-client.js');
const sc = require('./staking-client.js');

const STAKING_PROGRAM = process.env.STAKING_PROGRAM || '';
const TREASURY_PROGRAM = process.env.TREASURY_PROGRAM || process.env.PILL_TREASURY_PROGRAM || '';

/** Cuál está activo, o null si no hay ninguno. */
function cual() {
    if (STAKING_PROGRAM) return { modo: 'aparte', programa: STAKING_PROGRAM, cli: sc };
    if (TREASURY_PROGRAM) return { modo: 'tesoreria', programa: TREASURY_PROGRAM, cli: tc };
    return null;
}

/** Las PDAs del que esté activo, con nombres iguales en los dos casos. */
function pdas() {
    const q = cual();
    if (!q) return null;
    const p = q.cli.pdas(q.programa);
    return { config: p.config, stakeVault: p.stakeVault, rewardVault: p.rewardVault };
}

/** La posición de una wallet. Los dos clientes la llaman distinto. */
function posicionPda(wallet) {
    const q = cual();
    if (!q) return null;
    return q.modo === 'aparte' ? sc.stakeAccount(q.programa, wallet) : tc.stakePda(q.programa, wallet);
}

/*
 * La config, normalizada. Los dos programas guardan lo mismo con nombres distintos:
 * `total_stake_funded` / `total_funded`, y el de la tesorería lleva además un
 * `staking_ready` que aquí no existe porque el programa aparte no sirve para otra cosa.
 */
function decodeConfig(data) {
    const q = cual();
    if (!q) throw new Error('sin programa de staking configurado');
    const cfg = q.cli.decodeConfig(data);
    return {
        activo: q.modo === 'aparte' ? true : !!cfg.stakingReady,
        totalStaked: BigInt(cfg.totalStaked),
        accRewardPerShare: BigInt(cfg.accRewardPerShare),
        rewardRate: BigInt(cfg.rewardRate),
        periodFinish: Number(cfg.periodFinish),
        lastUpdate: Number(cfg.lastUpdate),
        aportado: BigInt(cfg.totalFunded != null ? cfg.totalFunded : cfg.totalStakeFunded),
        pagado: BigInt(cfg.totalPaid != null ? cfg.totalPaid : cfg.totalStakeRewardsPaid),
    };
}

function decodeStakeAccount(data) {
    const q = cual();
    if (!q) throw new Error('sin programa de staking configurado');
    const a = q.cli.decodeStakeAccount(data);
    return {
        amount: BigInt(a.amount),
        rewardPerSharePaid: BigInt(a.rewardPerSharePaid),
        pending: BigInt(a.pending),
        unstaking: BigInt(a.unstaking),
        unstakeReadyAt: Number(a.unstakeReadyAt),
    };
}

/*
 * La instrucción de una acción del usuario. Los nombres de la interfaz son los mismos
 * en los dos contratos; los del cliente, no.
 */
function ix(accion, { wallet, amountRaw, from, mint }) {
    const q = cual();
    if (!q) return null;
    const P = q.programa;
    if (q.modo === 'aparte') {
        switch (accion) {
            case 'stake': return sc.stake(P, { owner: wallet, from, amountRaw });
            case 'request_unstake': return sc.requestUnstake(P, { owner: wallet, amountRaw });
            case 'withdraw_unstaked': return sc.withdrawUnstaked(P, { owner: wallet, mint });
            case 'compound': return sc.compound(P, { owner: wallet });
            case 'claim': return sc.claimRewards(P, { owner: wallet, mint });
            default: return null;
        }
    }
    switch (accion) {
        case 'stake': return tc.stake(P, { owner: wallet, from, amountRaw });
        case 'request_unstake': return tc.requestUnstake(P, { owner: wallet, amountRaw });
        case 'withdraw_unstaked': return tc.withdrawUnstaked(P, { owner: wallet, mint });
        case 'compound': return tc.compoundStakeRewards(P, { owner: wallet });
        case 'claim': return tc.claimStakeRewards(P, { owner: wallet, mint });
        default: return null;
    }
}

/*
 * Llenar el pozo con el rake. Es la única diferencia de fondo entre los dos:
 *
 *   pill_treasury  el dinero sale de SU bóveda de custodia — está dentro del mismo
 *                  programa, así que firma la PDA.
 *   pill_staking   sale de una cuenta normal de la autoridad. El programa aparte no
 *                  custodia nada más que el staking, así que no tiene de dónde sacarlo
 *                  por su cuenta.
 *
 * Por eso `from` solo hace falta en el segundo caso.
 */
function ixFund({ authority, amountRaw, durationSecs, from }) {
    const q = cual();
    if (!q) return null;
    if (q.modo === 'tesoreria') {
        return tc.fundStakeRewards(q.programa, { authority, amountRaw, durationSecs });
    }
    // La cuenta de origen se deriva aqui y no en quien llama: es el unico sitio que
    // sabe que el contrato aparte la necesita, y pedirsela a todos los que barren
    // (rake, tienda) obliga a que los tres sepan algo que no es asunto suyo.
    const origen = from || (() => {
        const { PublicKey } = require('@solana/web3.js');
        const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
        const solana = require('./solana.js');
        return getAssociatedTokenAddressSync(new PublicKey(solana.MINT), new PublicKey(authority), true);
    })();
    return sc.fundRewards(q.programa, { authority, from: origen, amountRaw, duration: durationSecs });
}

module.exports = {
    cual, pdas, posicionPda, decodeConfig, decodeStakeAccount, ix, ixFund,
    get PROGRAMA() { const q = cual(); return q ? q.programa : null; },
    get MODO() { const q = cual(); return q ? q.modo : null; },
};
