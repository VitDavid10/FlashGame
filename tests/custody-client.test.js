/*
 * Tests del cliente del programa de custodia.
 *
 * Mismo riesgo que en treasury-client.test.js y por eso el mismo metodo: si alguien
 * anade una cuenta en medio de un #[derive(Accounts)] del .rs, el cliente sigue
 * compilando y mandando el orden viejo. On-chain eso es el dinero de los jugadores
 * moviendose donde no toca, o el decodificador leyendo el saldo en el offset del bump.
 *
 * Asi que estos tests LEEN EL .rs y lo comparan con el cliente. No es elegante, pero
 * es lo unico que se entera de que las dos mitades se han separado.
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
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const cc = require('../server/custody-client.js');

const RS = fs.readFileSync(path.join(__dirname, '..', 'programs', 'pill-custody', 'src', 'lib.rs'), 'utf8');
const PROGRAM_ID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const P = cc.pdas(PROGRAM_ID);
const mint = Keypair.generate().publicKey;
const authority = Keypair.generate().publicKey;
const jugador = Keypair.generate().publicKey;

/** Campos de un struct, en orden de declaracion. */
function camposDe(nombreStruct) {
    const re = new RegExp('struct ' + nombreStruct + "(?:<'info>)?\\s*\\{([\\s\\S]*?)\\n\\}", 'm');
    const m = RS.match(re);
    assert.ok(m, `no encuentro el struct ${nombreStruct} en lib.rs`);
    return [...m[1].matchAll(/^\s*pub\s+(\w+)\s*:\s*([^,]+),/gm)].map(x => ({ nombre: x[1], tipo: x[2].trim() }));
}

/** Las cuentas que manda el cliente, en el orden en que las manda. */
const claves = (ix) => ix.keys.map(k => k.pubkey.toBase58());

/* ===================== ORDEN DE LAS CUENTAS ===================== */

/*
 * Cada instruccion contra su struct. Se comparan la LONGITUD y las cuentas conocidas
 * en su posicion: un campo insertado en medio desplaza todo lo de detras, y cualquiera
 * de las dos comprobaciones lo caza.
 */
const CASOS = [
    {
        nombre: 'initialize', struct: 'Initialize',
        ix: () => cc.initialize(PROGRAM_ID, { mint, authority, payer: authority }),
        esperado: [P.config.toBase58(), P.custody.toBase58(), mint.toBase58(), authority.toBase58(),
            authority.toBase58(), TOKEN_PROGRAM_ID.toBase58(), SystemProgram.programId.toBase58(),
            SYSVAR_RENT_PUBKEY.toBase58()],
    },
    {
        nombre: 'deposit', struct: 'Deposit',
        ix: () => cc.deposit(PROGRAM_ID, { from: jugador, owner: authority, amountRaw: 1n }),
        esperado: [P.config.toBase58(), P.custody.toBase58(), jugador.toBase58(), authority.toBase58(),
            TOKEN_PROGRAM_ID.toBase58()],
    },
    {
        nombre: 'withdraw', struct: 'Withdraw',
        ix: () => cc.withdraw(PROGRAM_ID, { player: jugador, mint, authority, amountRaw: 1n }),
        esperado: [P.config.toBase58(), P.custody.toBase58(),
            getAssociatedTokenAddressSync(mint, jugador, true).toBase58(), mint.toBase58(),
            jugador.toBase58(), authority.toBase58(), TOKEN_PROGRAM_ID.toBase58(),
            ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()],
    },
    {
        nombre: 'transfer_authority', struct: 'AuthorityOnly',
        ix: () => cc.transferAuthority(PROGRAM_ID, { authority, nueva: jugador }),
        esperado: [P.config.toBase58(), authority.toBase58()],
    },
    {
        nombre: 'accept_authority', struct: 'AcceptAuthority',
        ix: () => cc.acceptAuthority(PROGRAM_ID, { nueva: jugador }),
        esperado: [P.config.toBase58(), jugador.toBase58()],
    },
];

for (const c of CASOS) {
    test(`${c.nombre}: las cuentas van en el orden de ${c.struct}`, () => {
        const campos = camposDe(c.struct);
        const ix = c.ix();
        assert.equal(ix.keys.length, campos.length,
            `${c.struct} tiene ${campos.length} cuentas y el cliente manda ${ix.keys.length}: `
            + 'alguien anadio o quito una y el cliente no se entero');
        assert.deepEqual(claves(ix), c.esperado, `orden distinto en ${c.nombre}`);
    });
}

test('el discriminador es el sha256 que usa Anchor, no un numero inventado', () => {
    for (const c of CASOS) {
        const esperado = crypto.createHash('sha256').update('global:' + c.nombre).digest().subarray(0, 8);
        assert.ok(c.ix().data.subarray(0, 8).equals(esperado), `discriminador malo en ${c.nombre}`);
    }
});

test('todas las instrucciones del programa tienen cliente', () => {
    const m = RS.match(/#\[program\]\s*pub mod pill_custody \{([\s\S]*?)\n\}\n/m);
    assert.ok(m, 'no encuentro el modulo #[program]');
    const enRust = [...m[1].matchAll(/pub fn (\w+)\s*\(/g)].map(x => x[1]);
    const conCliente = CASOS.map(c => c.nombre);
    for (const nombre of enRust) {
        assert.ok(conCliente.includes(nombre), `${nombre} existe en el programa y no tiene cliente`);
    }
});

/* ===================== EL DECODIFICADOR ===================== */

const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

/*
 * Option<Pubkey> COMO LO SERIALIZA BORSH, que es de longitud variable: None es un
 * solo byte, Some son 1 + 32.
 *
 * Esto lo escribia antes como 1 + 32 siempre, copiando lo que reserva `InitSpace`.
 * Pero InitSpace dimensiona la CUENTA, no los datos: con None quedan 32 bytes de cola
 * sin usar. El test construia el buffer con la misma suposicion equivocada que el
 * decodificador, asi que los dos estaban mal y el test pasaba igual. Se vio contra
 * devnet: el mint salia de otro sitio y los contadores a cero, sin error ninguno.
 */
const optPubkey = (pk) => pk ? Buffer.concat([Buffer.from([1]), pk.toBuffer()]) : Buffer.from([0]);

test('decodeConfig lee los campos en el orden de Config', () => {
    const campos = camposDe('Config').map(c => c.nombre);
    assert.deepEqual(campos, ['authority', 'pending_authority', 'mint', 'config_bump',
        'custody_bump', 'total_deposited', 'total_withdrawn'],
        'Config cambio en el .rs: hay que tocar decodeConfig()');

    // Una Config sintetica, campo a campo, para comprobar los offsets.
    const auth = Keypair.generate().publicKey;
    const mnt = Keypair.generate().publicKey;
    const buf = Buffer.concat([
        cc.accDisc('Config'),
        auth.toBuffer(),
        optPubkey(null),                             // pending_authority = None -> 1 byte
        mnt.toBuffer(),
        Buffer.from([254, 253]),                     // config_bump, custody_bump
        u64le(1234567), u64le(456),
        Buffer.alloc(32),                            // la cola que reserva InitSpace
    ]);
    const cfg = cc.decodeConfig(buf);
    assert.equal(cfg.authority, auth.toBase58());
    assert.equal(cfg.pendingAuthority, null);
    assert.equal(cfg.mint, mnt.toBase58());
    assert.equal(cfg.configBump, 254);
    assert.equal(cfg.custodyBump, 253);
    assert.equal(cfg.totalDeposited, '1234567');
    assert.equal(cfg.totalWithdrawn, '456');
});

test('decodeConfig lee la autoridad en cola cuando la hay', () => {
    // Con Some, el Option ocupa 33 y todo lo de detras se corre 32 bytes. Si el
    // decodificador usara un tamano fijo, uno de los dos casos leeria basura.
    const auth = Keypair.generate().publicKey, pend = Keypair.generate().publicKey;
    const mnt = Keypair.generate().publicKey;
    const buf = Buffer.concat([
        cc.accDisc('Config'), auth.toBuffer(),
        optPubkey(pend),                             // pending_authority = Some(..)
        mnt.toBuffer(),
        Buffer.from([250, 249]), u64le(77), u64le(11),
    ]);
    const cfg = cc.decodeConfig(buf);
    assert.equal(cfg.pendingAuthority, pend.toBase58());
    // Y lo de detras tiene que seguir cuadrando, que es lo que se rompia.
    assert.equal(cfg.mint, mnt.toBase58());
    assert.equal(cfg.configBump, 250);
    assert.equal(cfg.totalDeposited, '77');
    assert.equal(cfg.totalWithdrawn, '11');
});

test('el tamano de la cuenta es el que reserva InitSpace, no el de los datos', () => {
    // 8 + 32 + (1+32) + 32 + 1 + 1 + 8 + 8 = 123, que es lo que mide la cuenta real
    // en devnet. Con None solo se escriben 91 y los otros 32 quedan a cero: por eso
    // dimensionar y deserializar son dos cuentas distintas.
    const campos = camposDe('Config');
    const TAM = { 'Pubkey': 32, 'Option<Pubkey>': 33, 'u8': 1, 'u64': 8 };
    const total = 8 + campos.reduce((s, c) => s + (TAM[c.tipo] ?? NaN), 0);
    assert.equal(total, 123, 'Config cambio de tamano: revisa decodeConfig y el .rs');
});

test('decodeConfig rechaza una cuenta que no es suya', () => {
    // Sin esto, pasarle otra cuenta devolveria numeros con toda la pinta de ser
    // buenos. El discriminador es lo unico que distingue una Config de un monton de
    // bytes del tamano adecuado.
    const buf = Buffer.concat([cc.accDisc('Otra'), Buffer.alloc(120)]);
    assert.throws(() => cc.decodeConfig(buf), /no es una Config/);
});

/* ===================== LAS PDAs ===================== */

test('las PDAs salen de las semillas del programa y de nada mas', () => {
    const semillas = [...RS.matchAll(/pub const (\w+)_SEED: &\[u8\] = b"([^"]+)"/g)]
        .map(m => ({ nombre: m[1], valor: m[2] }));
    assert.deepEqual(semillas.map(s => s.valor).sort(), ['config', 'custody']);
    for (const s of semillas) {
        const [pda] = PublicKey.findProgramAddressSync([Buffer.from(s.valor)], new PublicKey(PROGRAM_ID));
        const mio = s.valor === 'config' ? P.config : P.custody;
        assert.equal(pda.toBase58(), mio.toBase58(), `la PDA de ${s.valor} no coincide`);
    }
});

test('la boveda es una PDA: no existe llave privada que pueda firmar por ella', () => {
    // Es LA propiedad del contrato. Una direccion fuera de la curva ed25519 no tiene
    // clave privada correspondiente, y por eso el dinero solo lo mueve el programa.
    assert.equal(PublicKey.isOnCurve(P.custody.toBytes()), false);
    assert.equal(PublicKey.isOnCurve(P.config.toBytes()), false);
});

test('solo el DEPLOYER compilado puede inicializar', () => {
    // Si esta constante desaparece, `initialize` vuelve a ser una carrera que
    // cualquiera puede ganar, y el despliegue entero se pierde.
    assert.match(RS, /pub const DEPLOYER: Pubkey/, 'ya no hay constante DEPLOYER');
    assert.match(RS, /constraint = payer\.key\(\) == DEPLOYER/, 'DEPLOYER existe pero no se comprueba');
});
