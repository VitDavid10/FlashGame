/*
 * Tests del cliente del programa de staking.
 *
 * Mismo metodo que en custody-client.test.js: se LEE el .rs y se compara con el
 * cliente, porque si alguien anade una cuenta en medio de un #[derive(Accounts)] el
 * cliente sigue compilando y mandando el orden viejo.
 *
 * Aqui hay ademas un campo u128 (`acc_reward_per_share`) y un Option<Pubkey>, que son
 * las dos formas mas faciles de descuadrar un decodificador sin que salte ningun
 * error: el u128 ocupa 16 bytes en dos mitades little-endian, y el Option es de
 * LONGITUD VARIABLE —None es 1 byte, no 33— aunque InitSpace reserve 33 siempre.
 *
 *   node --test "tests/*.test.js"
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const sc = require('../server/staking-client.js');

const RS = fs.readFileSync(path.join(__dirname, '..', 'programs', 'pill-staking', 'src', 'lib.rs'), 'utf8');
const PROGRAM_ID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const P = sc.pdas(PROGRAM_ID);
const mint = Keypair.generate().publicKey;
const authority = Keypair.generate().publicKey;
const owner = Keypair.generate().publicKey;
const SA = sc.stakeAccount(PROGRAM_ID, owner);

function camposDe(nombreStruct) {
    const re = new RegExp('struct ' + nombreStruct + "(?:<'info>)?\\s*\\{([\\s\\S]*?)\\n\\}", 'm');
    const m = RS.match(re);
    assert.ok(m, `no encuentro el struct ${nombreStruct} en lib.rs`);
    return [...m[1].matchAll(/^\s*pub\s+(\w+)\s*:\s*([^,]+),/gm)].map(x => ({ nombre: x[1], tipo: x[2].trim() }));
}

const claves = (ix) => ix.keys.map(k => k.pubkey.toBase58());
const ata = (o) => getAssociatedTokenAddressSync(mint, o, true).toBase58();

/* ===================== ORDEN DE LAS CUENTAS ===================== */

const CASOS = [
    {
        nombre: 'initialize', struct: 'Initialize',
        ix: () => sc.initialize(PROGRAM_ID, { mint, authority, payer: authority }),
        esperado: [P.config, P.stakeVault, P.rewardVault].map(String)
            .concat([mint.toBase58(), authority.toBase58(), authority.toBase58(),
                TOKEN_PROGRAM_ID.toBase58(), SystemProgram.programId.toBase58(), SYSVAR_RENT_PUBKEY.toBase58()]),
    },
    {
        nombre: 'stake', struct: 'Stake',
        ix: () => sc.stake(PROGRAM_ID, { from: authority, owner, amountRaw: 1n }),
        esperado: [P.config.toBase58(), P.stakeVault.toBase58(), SA.toBase58(), authority.toBase58(),
            owner.toBase58(), TOKEN_PROGRAM_ID.toBase58(), SystemProgram.programId.toBase58()],
    },
    {
        nombre: 'request_unstake', struct: 'RequestUnstake',
        ix: () => sc.requestUnstake(PROGRAM_ID, { owner, amountRaw: 1n }),
        esperado: [P.config.toBase58(), SA.toBase58(), owner.toBase58()],
    },
    {
        nombre: 'withdraw_unstaked', struct: 'WithdrawUnstaked',
        ix: () => sc.withdrawUnstaked(PROGRAM_ID, { owner, mint }),
        esperado: [P.config.toBase58(), P.stakeVault.toBase58(), SA.toBase58(), ata(owner),
            mint.toBase58(), owner.toBase58(), TOKEN_PROGRAM_ID.toBase58()],
    },
    {
        nombre: 'claim_rewards', struct: 'ClaimRewards',
        ix: () => sc.claimRewards(PROGRAM_ID, { owner, mint }),
        esperado: [P.config.toBase58(), P.rewardVault.toBase58(), SA.toBase58(), ata(owner),
            mint.toBase58(), owner.toBase58(), TOKEN_PROGRAM_ID.toBase58()],
    },
    {
        nombre: 'compound', struct: 'Compound',
        ix: () => sc.compound(PROGRAM_ID, { owner }),
        esperado: [P.config.toBase58(), P.rewardVault.toBase58(), P.stakeVault.toBase58(),
            SA.toBase58(), owner.toBase58(), TOKEN_PROGRAM_ID.toBase58()],
    },
    {
        nombre: 'fund_rewards', struct: 'FundRewards',
        ix: () => sc.fundRewards(PROGRAM_ID, { from: authority, authority, amountRaw: 1n, duration: 3600 }),
        esperado: [P.config.toBase58(), P.rewardVault.toBase58(), authority.toBase58(),
            authority.toBase58(), TOKEN_PROGRAM_ID.toBase58()],
    },
    {
        nombre: 'transfer_authority', struct: 'AuthorityOnly',
        ix: () => sc.transferAuthority(PROGRAM_ID, { authority, nueva: owner }),
        esperado: [P.config.toBase58(), authority.toBase58()],
    },
    {
        nombre: 'accept_authority', struct: 'AcceptAuthority',
        ix: () => sc.acceptAuthority(PROGRAM_ID, { nueva: owner }),
        esperado: [P.config.toBase58(), owner.toBase58()],
    },
];

for (const c of CASOS) {
    test(`${c.nombre}: las cuentas van en el orden de ${c.struct}`, () => {
        const campos = camposDe(c.struct);
        const ix = c.ix();
        assert.equal(ix.keys.length, campos.length,
            `${c.struct} tiene ${campos.length} cuentas y el cliente manda ${ix.keys.length}`);
        assert.deepEqual(claves(ix), c.esperado, `orden distinto en ${c.nombre}`);
    });
}

test('el discriminador es el sha256 que usa Anchor', () => {
    for (const c of CASOS) {
        const esperado = crypto.createHash('sha256').update('global:' + c.nombre).digest().subarray(0, 8);
        assert.ok(c.ix().data.subarray(0, 8).equals(esperado), `discriminador malo en ${c.nombre}`);
    }
});

test('todas las instrucciones del programa tienen cliente', () => {
    const m = RS.match(/#\[program\]\s*pub mod pill_staking \{([\s\S]*?)\n\}\n/m);
    assert.ok(m, 'no encuentro el modulo #[program]');
    const enRust = [...m[1].matchAll(/pub fn (\w+)\s*\(/g)].map(x => x[1]);
    const conCliente = CASOS.map(c => c.nombre);
    for (const nombre of enRust) {
        assert.ok(conCliente.includes(nombre), `${nombre} existe en el programa y no tiene cliente`);
    }
});

/* ===================== LOS DECODIFICADORES ===================== */

const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const i64le = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
/** u128 little-endian: 16 bytes, la mitad baja primero. */
const u128le = (n) => { const b = Buffer.alloc(16); const v = BigInt(n);
    b.writeBigUInt64LE(v & 0xffffffffffffffffn, 0); b.writeBigUInt64LE(v >> 64n, 8); return b; };
/** Option<Pubkey> como lo serializa Borsh: None es 1 byte, Some son 1+32. */
const optPubkey = (pk) => pk ? Buffer.concat([Buffer.from([1]), pk.toBuffer()]) : Buffer.from([0]);

test('decodeConfig lee los campos en el orden de Config', () => {
    assert.deepEqual(camposDe('Config').map(c => c.nombre),
        ['authority', 'pending_authority', 'mint', 'config_bump', 'stake_bump', 'rewards_bump',
            'total_staked', 'acc_reward_per_share', 'reward_rate', 'period_finish', 'last_update',
            'total_funded', 'total_paid'],
        'Config cambio en el .rs: hay que tocar decodeConfig()');

    const auth = Keypair.generate().publicKey, mnt = Keypair.generate().publicKey;
    // Un acc_reward_per_share que NO cabe en 64 bits: si el decodificador leyera solo
    // la mitad baja, este numero lo cazaria y un valor pequeno no.
    const GRANDE = (1n << 70n) + 12345n;
    const buf = Buffer.concat([
        sc.accDisc('Config'), auth.toBuffer(), optPubkey(null), mnt.toBuffer(),
        Buffer.from([254, 253, 252]),
        u64le(1000_000000), u128le(GRANDE), u64le(77), i64le(1800000000), i64le(1700000000),
        u64le(500_000000), u64le(9_000000),
        Buffer.alloc(32),                               // la cola que reserva InitSpace
    ]);
    const cfg = sc.decodeConfig(buf);
    assert.equal(cfg.authority, auth.toBase58());
    assert.equal(cfg.pendingAuthority, null);
    assert.equal(cfg.mint, mnt.toBase58());
    assert.deepEqual([cfg.configBump, cfg.stakeBump, cfg.rewardsBump], [254, 253, 252]);
    assert.equal(cfg.totalStaked, '1000000000');
    assert.equal(cfg.accRewardPerShare, GRANDE.toString());
    assert.equal(cfg.rewardRate, '77');
    assert.equal(cfg.periodFinish, 1800000000);
    assert.equal(cfg.lastUpdate, 1700000000);
    assert.equal(cfg.totalFunded, '500000000');
    assert.equal(cfg.totalPaid, '9000000');
});

test('decodeConfig con autoridad en cola: el Option ocupa 33 y todo se corre', () => {
    const auth = Keypair.generate().publicKey, pend = Keypair.generate().publicKey;
    const mnt = Keypair.generate().publicKey;
    const buf = Buffer.concat([
        sc.accDisc('Config'), auth.toBuffer(), optPubkey(pend), mnt.toBuffer(),
        Buffer.from([1, 2, 3]), u64le(42), u128le(7), u64le(1), i64le(2), i64le(3), u64le(4), u64le(5),
    ]);
    const cfg = sc.decodeConfig(buf);
    assert.equal(cfg.pendingAuthority, pend.toBase58());
    // Y lo de DETRAS tiene que seguir cuadrando: es lo que se rompe si el Option se
    // lee con tamano fijo.
    assert.equal(cfg.mint, mnt.toBase58());
    assert.equal(cfg.totalStaked, '42');
    assert.equal(cfg.totalPaid, '5');
});

test('decodeStakeAccount lee los campos en el orden de StakeAccount', () => {
    assert.deepEqual(camposDe('StakeAccount').map(c => c.nombre),
        ['owner', 'amount', 'reward_per_share_paid', 'pending', 'unstaking', 'unstake_ready_at', 'bump'],
        'StakeAccount cambio en el .rs: hay que tocar decodeStakeAccount()');

    const o = Keypair.generate().publicKey;
    const buf = Buffer.concat([
        sc.accDisc('StakeAccount'), o.toBuffer(), u64le(500_000000), u128le((1n << 65n) + 3n),
        u64le(12_000000), u64le(7_000000), i64le(1900000000), Buffer.from([251]),
    ]);
    const acc = sc.decodeStakeAccount(buf);
    assert.equal(acc.owner, o.toBase58());
    assert.equal(acc.amount, '500000000');
    assert.equal(acc.rewardPerSharePaid, ((1n << 65n) + 3n).toString());
    assert.equal(acc.pending, '12000000');
    assert.equal(acc.unstaking, '7000000');
    assert.equal(acc.unstakeReadyAt, 1900000000);
    assert.equal(acc.bump, 251);
});

test('los decodificadores rechazan una cuenta que no es suya', () => {
    // El discriminador es lo unico que distingue una Config de una StakeAccount: sin
    // comprobarlo, cada uno leeria del otro numeros con toda la pinta de ser buenos.
    assert.throws(() => sc.decodeConfig(Buffer.concat([sc.accDisc('StakeAccount'), Buffer.alloc(160)])),
        /no es una Config/);
    assert.throws(() => sc.decodeStakeAccount(Buffer.concat([sc.accDisc('Config'), Buffer.alloc(160)])),
        /no es una StakeAccount/);
});

/* ===================== LA CUENTA DEL RENDIMIENTO ===================== */

/*
 * pendienteAhora() rehace en JS lo que hace el programa en Rust. Si las dos cuentas
 * se separan, la interfaz ensena un numero y el claim paga otro — y el usuario piensa
 * que le han robado. Estos tests fijan los casos que mas cuestan de ver.
 */

const cfgBase = (over = {}) => Object.assign({
    accRewardPerShare: '0', totalStaked: '0', rewardRate: '0',
    periodFinish: 0, lastUpdate: 1000,
}, over);
const accBase = (over = {}) => Object.assign({
    amount: '0', rewardPerSharePaid: '0', pending: '0',
}, over);

test('sin nada staked no se acumula nada, por mucho que gotee', () => {
    const cfg = cfgBase({ totalStaked: '0', rewardRate: '100', periodFinish: 999999 });
    assert.equal(sc.pendienteAhora(cfg, accBase(), 5000), '0');
});

test('el unico staker se lo lleva todo del periodo', () => {
    // 1000 tokens dentro, 100 por segundo, 10 segundos -> 1000.
    const cfg = cfgBase({ totalStaked: '1000', rewardRate: '100', periodFinish: 999999, lastUpdate: 1000 });
    const acc = accBase({ amount: '1000' });
    assert.equal(sc.pendienteAhora(cfg, acc, 1010), '1000');
});

test('dos stakers a partes iguales cobran la mitad cada uno', () => {
    const cfg = cfgBase({ totalStaked: '2000', rewardRate: '100', periodFinish: 999999, lastUpdate: 1000 });
    assert.equal(sc.pendienteAhora(cfg, accBase({ amount: '1000' }), 1010), '500');
});

test('el goteo no paga mas alla de period_finish', () => {
    // Se paran a los 10 s aunque se pregunte por el segundo 1000: si no, el pool
    // prometeria recompensas que no tiene.
    const cfg = cfgBase({ totalStaked: '1000', rewardRate: '100', periodFinish: 1010, lastUpdate: 1000 });
    const acc = accBase({ amount: '1000' });
    assert.equal(sc.pendienteAhora(cfg, acc, 2000), '1000');
});

test('quien entra tarde no cobra lo de antes de entrar', () => {
    // El indice global ya vale 5 * PRECISION cuando entra, y el suyo apunta ahi:
    // la diferencia es cero hasta que pase mas tiempo.
    const cfg = cfgBase({
        accRewardPerShare: (5n * sc.PRECISION).toString(),
        totalStaked: '1000', rewardRate: '0', periodFinish: 0, lastUpdate: 1000,
    });
    const acc = accBase({ amount: '1000', rewardPerSharePaid: (5n * sc.PRECISION).toString() });
    assert.equal(sc.pendienteAhora(cfg, acc, 5000), '0');
});

test('lo ya liquidado no se pierde al preguntar otra vez', () => {
    const cfg = cfgBase({ totalStaked: '1000', rewardRate: '0', periodFinish: 0 });
    assert.equal(sc.pendienteAhora(cfg, accBase({ amount: '1000', pending: '333' }), 9999), '333');
});

test('el APR es cero cuando el goteo ya termino', () => {
    // Es lo honesto: no hay nada repartiendose, asi que ensenar el APR del periodo
    // anterior seria prometer un rendimiento que ya no existe.
    const cfg = cfgBase({ totalStaked: '1000', rewardRate: '100', periodFinish: 500 });
    assert.equal(sc.aprAprox(cfg, 1000), 0);
});

test('el APR sale del ritmo de ahora extrapolado a un anio', () => {
    // 1 token/s sobre 31.536.000 staked = 1 anio de reparto = 100%.
    const cfg = cfgBase({ totalStaked: '31536000', rewardRate: '1', periodFinish: 999999999 });
    assert.equal(sc.aprAprox(cfg, 1000), 100);
});

/* ===================== LAS PDAs Y LAS CONSTANTES ===================== */

test('las PDAs salen de las semillas del programa y de nada mas', () => {
    const semillas = [...RS.matchAll(/pub const (\w+)_SEED: &\[u8\] = b"([^"]+)"/g)].map(m => m[2]);
    assert.deepEqual(semillas.sort(), ['config', 'rewards', 'stake']);
    for (const [semilla, mio] of [['config', P.config], ['stake', P.stakeVault], ['rewards', P.rewardVault]]) {
        const [pda] = PublicKey.findProgramAddressSync([Buffer.from(semilla)], new PublicKey(PROGRAM_ID));
        assert.equal(pda.toBase58(), mio.toBase58(), `la PDA de ${semilla} no coincide`);
    }
});

test('las dos bovedas son PDAs distintas y sin llave privada', () => {
    // Distintas a proposito: si el principal y las recompensas compartieran boveda,
    // un error de calculo pagaria rendimiento con el principal de otro.
    assert.notEqual(P.stakeVault.toBase58(), P.rewardVault.toBase58());
    for (const pda of [P.config, P.stakeVault, P.rewardVault]) {
        assert.equal(PublicKey.isOnCurve(pda.toBytes()), false);
    }
});

test('la posicion de cada wallet es una PDA distinta', () => {
    const otro = Keypair.generate().publicKey;
    assert.notEqual(sc.stakeAccount(PROGRAM_ID, owner).toBase58(),
        sc.stakeAccount(PROGRAM_ID, otro).toBase58());
});

test('las constantes del cliente coinciden con las del programa', () => {
    // Si el enfriamiento del .rs cambia y el del cliente no, la interfaz ensena una
    // fecha de retirada que el programa rechaza.
    const cool = RS.match(/UNSTAKE_COOLDOWN_SECS: i64 = ([^;]+);/);
    assert.ok(cool, 'no encuentro UNSTAKE_COOLDOWN_SECS');
    assert.equal(eval(cool[1].replace(/_/g, '')), sc.UNSTAKE_COOLDOWN_SECS);

    const prec = RS.match(/PRECISION: u128 = ([^;]+);/);
    assert.ok(prec, 'no encuentro PRECISION');
    assert.equal(BigInt(prec[1].replace(/_/g, '')), sc.PRECISION);
});

test('solo el DEPLOYER compilado puede inicializar', () => {
    assert.match(RS, /pub const DEPLOYER: Pubkey/, 'ya no hay constante DEPLOYER');
    assert.match(RS, /constraint = payer\.key\(\) == DEPLOYER/, 'DEPLOYER existe pero no se comprueba');
});

test('no hay ninguna salida de la boveda del principal hacia la autoridad', () => {
    /*
     * Es LA garantia del programa. El principal de los stakers solo puede ir a la
     * cuenta asociada de su dueno (withdraw_unstaked) o a la boveda de recompensas no,
     * al reves: de recompensas al principal (compound). Si alguien anade una
     * instruccion que mueva stake_vault a otro sitio, este test lo caza.
     */
    const desdeStake = [...RS.matchAll(/from: ctx\.accounts\.stake_vault[\s\S]{0,200}?to: ctx\.accounts\.(\w+)/g)]
        .map(m => m[1]);
    assert.deepEqual(desdeStake, ['to'],
        'algo mas saca de la boveda del principal: ' + desdeStake.join(', '));
});
