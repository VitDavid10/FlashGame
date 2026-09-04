/*
 * TODO LO QUE HAY EN LA CADENA, EN UNA SOLA RESPUESTA.
 *
 * Abrir Solscan direccion por direccion no sirve para entender nada: sale una lista
 * de cuentas sin nombre y hay que acordarse de cual es cual. Y la pestaña de holders
 * de un token de devnet muchas veces ni se rellena.
 *
 * Esto responde a las tres preguntas que de verdad importan:
 *
 *   1. ¿Que direcciones tiene este proyecto y que hace cada una?
 *   2. ¿Cuanto hay en cada una AHORA?
 *   3. ¿Quienes son los mayores holders, y cuales de ellos son contratos?
 *
 * Los holders se leen con getProgramAccounts sobre el programa de tokens, filtrando
 * por este mint. De cada cuenta se saca su dueño y su saldo y, si es una de las
 * nuestras, se le pone nombre. Asi "esa direccion con el 12% es un contrato" deja de
 * ser una afirmacion que hay que creerse.
 *
 * Todo es de solo lectura y todo lleva su enlace: lo que sale aqui se puede
 * contrastar en el explorador, que es el punto.
 */
'use strict';

const solana = require('./solana.js');

const CACHE_MS = 30000;
let _cache = null, _cacheAt = 0;

/*
 * Los holders van con su propia cache y mucho mas larga.
 *
 * getTokenLargestAccounts es una llamada cara y el RPC publico de devnet la limita
 * agresivamente: sale 429 con solo pedirla dos veces seguidas. Y sobre todo, ante un
 * fallo se devuelve LA ULTIMA LISTA BUENA en vez de nada — una tabla que desaparece
 * cada vez que el RPC tiene un mal minuto es peor que una con cinco minutos de
 * antiguedad, que ademas se dice.
 */
const HOLDERS_MS = 5 * 60 * 1000;
let _holders = null, _holdersAt = 0;

const CLUSTER = /devnet/i.test(solana.RPC) ? 'devnet' : (/testnet/i.test(solana.RPC) ? 'testnet' : null);
const url = (tipo, id) => `https://solscan.io/${tipo}/${id}` + (CLUSTER ? `?cluster=${CLUSTER}` : '');

function conn() {
    const { Connection } = require('@solana/web3.js');
    return new Connection(solana.RPC, 'confirmed');
}

/*
 * Las direcciones que el proyecto conoce, con lo que hace cada una y si su dueño
 * puede firmar. Eso ultimo es LO que distingue un contrato de una wallet: una PDA
 * esta fuera de la curva ed25519, asi que no existe ninguna llave privada capaz de
 * moverla.
 */
function catalogo() {
    const { PublicKey } = require('@solana/web3.js');
    const out = [];
    const mete = (o) => { if (o.address) out.push(o); };

    const esPda = (a) => { try { return !PublicKey.isOnCurve(new PublicKey(a).toBytes()); } catch (e) { return false; } };

    mete({
        clave: 'rewards', nombre: 'Rewards wallet',
        address: solana.rewardsPubkey(),
        que: 'Pays the daily leaderboard prizes. This is the team\'s allocation, not money the game earned.',
        tipo: 'wallet',
    });
    if (solana.rewardsAparte()) {
        mete({
            clave: 'authority', nombre: 'Authority',
            address: solana.authorityPubkey(),
            que: 'Signs the server\'s operations and pays gas. It does not pay prizes.',
            tipo: 'wallet',
        });
    }

    const custodia = process.env.CUSTODY_PROGRAM || '';
    if (custodia) {
        const cc = require('./custody-client.js');
        const p = cc.pdas(custodia);
        mete({ clave: 'custodyProgram', nombre: 'Custody · contract', address: custodia,
            que: 'The program that holds players\' in-game balance.', tipo: 'programa' });
        mete({ clave: 'custodyVault', nombre: 'Custody · vault', address: p.custody.toBase58(),
            que: 'Player deposits. This is money owed to them, not revenue.',
            tipo: 'boveda', pda: esPda(p.custody.toBase58()) });
    }

    const st = require('./staking.js');
    if (st.PROGRAMA) {
        const p = st.pdas();
        mete({ clave: 'stakingProgram', nombre: 'Staking · contract', address: st.PROGRAMA,
            que: 'The staking program. ' + (st.MODO === 'aparte' ? 'Its own contract.' : 'Lives inside the treasury contract.'),
            tipo: 'programa' });
        mete({ clave: 'stakeVault', nombre: 'Staking · principal', address: p.stakeVault.toBase58(),
            que: '$PILL people have locked. It is theirs and leaves when they ask.',
            tipo: 'boveda', pda: esPda(p.stakeVault.toBase58()) });
        mete({ clave: 'rewardVault', nombre: 'Staking · reward pool', address: p.rewardVault.toBase58(),
            que: 'What the game earned, waiting to be split between stakers.',
            tipo: 'boveda', pda: esPda(p.rewardVault.toBase58()) });
    }

    const tes = solana.TREASURY_PROGRAM;
    if (tes) {
        const tc = require('./treasury-client.js');
        const p = tc.pdas(tes);
        mete({ clave: 'treasuryProgram', nombre: 'Treasury · contract', address: tes,
            que: 'The locked treasury and on-chain prize program.', tipo: 'programa' });
        mete({ clave: 'treasuryVault', nombre: 'Treasury · vault', address: p.treasury.toBase58(),
            que: 'The locked treasury. Before the unlock date the only way out is a claim.',
            tipo: 'boveda', pda: esPda(p.treasury.toBase58()) });
    }
    return out;
}

/** El saldo en $PILL de la cuenta asociada de un dueño, o null si no tiene. */
async function saldoDe(c, dueno) {
    const { PublicKey } = require('@solana/web3.js');
    const { getAssociatedTokenAddressSync, getAccount } = require('@solana/spl-token');
    try {
        const ata = getAssociatedTokenAddressSync(new PublicKey(solana.MINT), new PublicKey(dueno), true);
        return Number((await getAccount(c, ata)).amount) / 10 ** solana.DECIMALS;
    } catch (e) { return null; }
}

/** El saldo de una token account que YA es la cuenta (las bovedas de los contratos). */
async function saldoCuenta(c, cuenta) {
    const { PublicKey } = require('@solana/web3.js');
    const { getAccount } = require('@solana/spl-token');
    try { return Number((await getAccount(c, new PublicKey(cuenta))).amount) / 10 ** solana.DECIMALS; }
    catch (e) { return null; }
}

async function estado() {
    if (_cache && Date.now() - _cacheAt < CACHE_MS) return _cache;
    if (!solana.MINT) return { error: 'sin token configurado' };

    const { PublicKey } = require('@solana/web3.js');
    const { getMint } = require('@solana/spl-token');
    const c = conn();

    const out = {
        cluster: CLUSTER || 'mainnet',
        rpc: solana.RPC,
        mint: { address: solana.MINT, url: url('token', solana.MINT) },
        cuentas: [],
        holders: [],
    };

    try {
        const m = await getMint(c, new PublicKey(solana.MINT));
        out.mint.supply = Number(m.supply) / 10 ** solana.DECIMALS;
        out.mint.decimals = m.decimals;
        // Sin autoridad de acuñacion no se pueden crear mas tokens NUNCA. Es de las
        // pocas cosas que un holder puede comprobar de un vistazo y que no depende de
        // que nadie cumpla su palabra.
        out.mint.mintAuthority = m.mintAuthority ? m.mintAuthority.toBase58() : null;
        out.mint.puedeAcunarMas = !!m.mintAuthority;
        out.mint.freezeAuthority = m.freezeAuthority ? m.freezeAuthority.toBase58() : null;
    } catch (e) { out.mint.error = e.message; }

    // Las cuentas conocidas, con su saldo.
    for (const it of catalogo()) {
        const saldo = it.tipo === 'boveda' ? await saldoCuenta(c, it.address)
            : it.tipo === 'wallet' ? await saldoDe(c, it.address)
            : null;
        out.cuentas.push(Object.assign({}, it, {
            pill: saldo,
            url: url(it.tipo === 'programa' ? 'account' : 'account', it.address),
        }));
    }

    /*
     * LOS HOLDERS.
     *
     * NO con getTokenLargestAccounts: el RPC publico de devnet lo tiene bloqueado y
     * devuelve 429 siempre, no por usarlo mucho. Es exactamente la razon de que la
     * pestaña de holders de Solscan salga vacia en devnet.
     *
     * Con getProgramAccounts sobre el programa de tokens, filtrando por este mint, si
     * funciona. `dataSlice` pide solo 40 bytes de cada cuenta —el dueño (32) y el
     * saldo (8)— en vez de los 165 completos: es lo que hace que la llamada sea
     * barata y no la tumbe el RPC.
     */
    if (_holders && Date.now() - _holdersAt < HOLDERS_MS) {
        out.holders = _holders;
        out.holdersEdad = Math.round((Date.now() - _holdersAt) / 1000);
    } else try {
        const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
        const cuentas = await c.getProgramAccounts(TOKEN_PROGRAM_ID, {
            filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: solana.MINT } }],
            dataSlice: { offset: 32, length: 40 },
        });

        const conocidas = new Map();
        for (const it of out.cuentas) {
            conocidas.set(it.address, it);                 // la boveda, que ES la cuenta
            if (it.tipo === 'wallet') {
                // De una wallet, lo que sale en la lista es su cuenta asociada.
                const { getAssociatedTokenAddressSync } = require('@solana/spl-token');
                try {
                    const ata = getAssociatedTokenAddressSync(
                        new PublicKey(solana.MINT), new PublicKey(it.address), true).toBase58();
                    conocidas.set(ata, it);
                } catch (e) {}
            }
        }

        const supply = out.mint.supply || 0;
        out.holders = cuentas.map(({ pubkey, account }) => {
            const d = account.data;
            const dueno = new PublicKey(d.subarray(0, 32)).toBase58();
            const pill = Number(d.readBigUInt64LE(32)) / 10 ** solana.DECIMALS;
            const cuenta = pubkey.toBase58();
            const yo = conocidas.get(cuenta) || conocidas.get(dueno);
            return {
                cuenta, dueno, pill,
                pct: supply > 0 ? (pill / supply) * 100 : null,
                nombre: yo ? yo.nombre : null,
                que: yo ? yo.que : null,
                // Un contrato no puede firmar: su direccion esta fuera de la curva
                // ed25519, asi que no existe llave privada capaz de moverla.
                esContrato: !!(yo && (yo.tipo === 'boveda' || yo.pda)),
                url: url('account', cuenta),
                urlDueno: url('account', dueno),
            };
        }).filter(h => h.pill > 0).sort((a, b) => b.pill - a.pill);

        _holders = out.holders; _holdersAt = Date.now();
        out.holdersEdad = 0;
    } catch (e) {
        // Se ensena la ultima lista buena diciendo de cuando es: una tabla que
        // desaparece cada vez que el RPC tiene un mal minuto es peor que una con
        // cinco minutos de antiguedad, que ademas se dice.
        if (_holders) {
            out.holders = _holders;
            out.holdersEdad = Math.round((Date.now() - _holdersAt) / 1000);
            out.holdersViejos = true;
        }
        out.holdersError = String(e.message || e).split(String.fromCharCode(10))[0].slice(0, 120);
    }

    _cache = out; _cacheAt = Date.now();
    return out;
}

module.exports = { estado, catalogo, url };
