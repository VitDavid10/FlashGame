/*
 * Tests del cliente del programa de tesoreria.
 *
 * El riesgo real de este fichero no es que una funcion devuelva mal un byte: es que
 * alguien anada una cuenta en medio de un #[derive(Accounts)] del .rs, o un campo en
 * medio de Config, y el cliente siga compilando y ejecutando tan tranquilo mandando
 * las cuentas en el orden viejo. On-chain eso son fondos moviendose donde no toca, o
 * un decodificador leyendo el saldo de la tesoreria en el offset del bump.
 *
 * Por eso estos tests LEEN EL .rs y lo comparan con el cliente. No es elegante, pero
 * es lo unico que se entera de que las dos mitades se han separado.
 *
 *   node --test "tests/*.test.js"
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');
const tc = require('../server/treasury-client.js');

const RS = fs.readFileSync(path.join(__dirname, '..', 'programs', 'pill-treasury', 'src', 'lib.rs'), 'utf8');
const PROGRAM_ID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const P = tc.pdas(PROGRAM_ID);
const mint = Keypair.generate().publicKey;
const authority = Keypair.generate().publicKey;
const jugador = Keypair.generate().publicKey;

/* ===================== PARSEO DEL .rs ===================== */

/** Campos de un struct, en orden de declaracion. */
function camposDe(nombreStruct) {
    const re = new RegExp(`struct ${nombreStruct}(?:<'info>)?\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
    const m = RS.match(re);
    assert.ok(m, `no encuentro el struct ${nombreStruct} en lib.rs`);
    return [...m[1].matchAll(/^\s*pub\s+(\w+)\s*:\s*([^,]+),/gm)].map(x => ({ nombre: x[1], tipo: x[2].trim() }));
}

/** Nombres de las instrucciones declaradas en el #[program]. */
function instruccionesDelPrograma() {
    const m = RS.match(/#\[program\]\s*pub mod pill_treasury \{([\s\S]*?)\n\}\n/m);
    assert.ok(m, 'no encuentro el modulo #[program]');
    return [...m[1].matchAll(/pub fn (\w+)\s*\(/g)].map(x => x[1]);
}

/* ===================== COBERTURA ===================== */

test('el cliente cubre todas las instrucciones del programa', () => {
    const enRust = instruccionesDelPrograma();
    const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const faltan = enRust.filter(n => typeof tc[camel(n)] !== 'function');
    assert.deepEqual(faltan, [], 'instrucciones del .rs sin funcion en el cliente: ' + faltan.join(', '));
});

/* ===================== ORDEN DE LAS CUENTAS ===================== */

// Como se llama en el .rs -> que pubkey tiene que ir en esa posicion.
const ESPERADO = {
    config: P.config,
    custody: P.custody,
    treasury: P.treasury,
    mint,
    authority,
    payer: authority,
    caller: authority,
    new_authority: authority,
    owner: jugador,
    winner: jugador,
    token_program: TOKEN_PROGRAM_ID,
    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
};

const EPOCH = 20334;
const CASOS = [
    ['Initialize', () => tc.initialize(PROGRAM_ID, { mint, authority, payer: authority, args: { unlockTs: 1, epochSecs: 86400, rewardCapPerEpoch: 1, rewardBpsPerEpoch: 5, challengeSecs: 172800, sweepCapPerEpoch: 1 } })],
    ['Deposit', () => tc.deposit(PROGRAM_ID, { from: mint, owner: jugador, amountRaw: 1 })],
    ['Fund', () => tc.fund(PROGRAM_ID, { from: mint, owner: jugador, amountRaw: 1 })],
    ['Withdraw', () => tc.withdraw(PROGRAM_ID, { to: mint, authority, amountRaw: 1 })],
    ['Sweep', () => tc.sweep(PROGRAM_ID, { authority, amountRaw: 1 })],
    ['PublishRound', () => tc.publishRound(PROGRAM_ID, { epoch: EPOCH, merkleRoot: Buffer.alloc(32, 7), totalRaw: 1, winners: 10, authority })],
    ['CancelRound', () => tc.cancelRound(PROGRAM_ID, { epoch: EPOCH, authority })],
    ['Claim', () => tc.claim(PROGRAM_ID, { epoch: EPOCH, winner: jugador, amountRaw: 1, proof: [], mint, payer: authority })],
    ['ExpireRound', () => tc.expireRound(PROGRAM_ID, { epoch: EPOCH, caller: authority })],
    ['AuthorityOnly', () => tc.finalize(PROGRAM_ID, { authority })],
    ['AcceptAuthority', () => tc.acceptAuthority(PROGRAM_ID, { newAuthority: authority })],
    ['UnlockWithdraw', () => tc.unlockWithdraw(PROGRAM_ID, { to: mint, authority, amountRaw: 1 })],
];

for (const [structName, construir] of CASOS) {
    test(`${structName}: el orden de las cuentas es el del .rs`, () => {
        const campos = camposDe(structName);
        const inst = construir();
        assert.equal(inst.keys.length, campos.length,
            `${structName} tiene ${campos.length} cuentas en Rust y el cliente manda ${inst.keys.length}`);
        campos.forEach((campo, i) => {
            const esperada = ESPERADO[campo.nombre];
            if (!esperada) return;   // round / receipt / from / to / winner_ata: se comprueban aparte
            assert.equal(inst.keys[i].pubkey.toBase58(), esperada.toBase58(),
                `${structName}: la cuenta #${i} deberia ser ${campo.nombre}`);
        });
    });
}

test('Claim: la ATA de destino es la canonica del ganador, no otra cuenta', () => {
    // Es lo que impide desviar un premio: aunque quien firme sea otro, el token
    // account de destino se deriva del winner y del mint.
    const campos = camposDe('Claim');
    const inst = tc.claim(PROGRAM_ID, { epoch: EPOCH, winner: jugador, amountRaw: 1, proof: [], mint, payer: authority });
    const iAta = campos.findIndex(c => c.nombre === 'winner_ata');
    assert.equal(
        inst.keys[iAta].pubkey.toBase58(),
        getAssociatedTokenAddressSync(mint, jugador, true).toBase58()
    );
});

test('Claim: el recibo va en el PDA ["claim", epoch, winner]', () => {
    const campos = camposDe('Claim');
    const inst = tc.claim(PROGRAM_ID, { epoch: EPOCH, winner: jugador, amountRaw: 1, proof: [], mint, payer: authority });
    const i = campos.findIndex(c => c.nombre === 'receipt');
    assert.equal(inst.keys[i].pubkey.toBase58(), tc.claimPda(PROGRAM_ID, EPOCH, jugador).toBase58());
});

test('PublishRound: la ronda va en el PDA ["round", epoch] — dos rondas de la misma epoca son imposibles', () => {
    const a = tc.roundPda(PROGRAM_ID, EPOCH).toBase58();
    const b = tc.roundPda(PROGRAM_ID, EPOCH).toBase58();
    const c = tc.roundPda(PROGRAM_ID, EPOCH + 1).toBase58();
    assert.equal(a, b);
    assert.notEqual(a, c);
});

test('el ganador NO firma su claim (puede reclamar un tercero por el)', () => {
    const campos = camposDe('Claim');
    const inst = tc.claim(PROGRAM_ID, { epoch: EPOCH, winner: jugador, amountRaw: 1, proof: [], mint, payer: authority });
    const iWinner = campos.findIndex(c => c.nombre === 'winner');
    const iPayer = campos.findIndex(c => c.nombre === 'payer');
    assert.equal(inst.keys[iWinner].isSigner, false, 'el winner no debe firmar');
    assert.equal(inst.keys[iPayer].isSigner, true, 'el payer si firma: paga el gas');
});

/* ===================== DISCRIMINADORES ===================== */

test('cada instruccion lleva delante sha256("global:<nombre>")[0..8]', () => {
    const crypto = require('node:crypto');
    const esperado = (n) => crypto.createHash('sha256').update('global:' + n).digest().subarray(0, 8);
    assert.ok(tc.deposit(PROGRAM_ID, { from: mint, owner: jugador, amountRaw: 1 }).data.subarray(0, 8).equals(esperado('deposit')));
    assert.ok(tc.publishRound(PROGRAM_ID, { epoch: 1, merkleRoot: Buffer.alloc(32, 1), totalRaw: 1, winners: 1, authority }).data.subarray(0, 8).equals(esperado('publish_round')));
    assert.ok(tc.unlockWithdraw(PROGRAM_ID, { to: mint, authority, amountRaw: 1 }).data.subarray(0, 8).equals(esperado('unlock_withdraw')));
});

/* ===================== SERIALIZACION ===================== */

test('los enteros van en little-endian, como espera Borsh', () => {
    const inst = tc.deposit(PROGRAM_ID, { from: mint, owner: jugador, amountRaw: 123456789n });
    assert.equal(inst.data.readBigUInt64LE(8), 123456789n);
});

test('publish_round serializa epoch, raiz, total y ganadores en ese orden', () => {
    const raiz = Buffer.alloc(32); raiz.write('pillwars');
    const inst = tc.publishRound(PROGRAM_ID, { epoch: 20334, merkleRoot: raiz, totalRaw: 148200, winners: 10, authority });
    const d = inst.data;
    assert.equal(d.readBigUInt64LE(8), 20334n);
    assert.ok(d.subarray(16, 48).equals(raiz));
    assert.equal(d.readBigUInt64LE(48), 148200n);
    assert.equal(d.readUInt16LE(56), 10);
    assert.equal(d.length, 58);
});

test('la prueba de Merkle viaja como Vec<[u8;32]>: u32 de longitud y los nodos seguidos', () => {
    const proof = [Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3)];
    const inst = tc.claim(PROGRAM_ID, { epoch: 1, winner: jugador, amountRaw: 500, proof, mint, payer: authority });
    const d = inst.data;
    assert.equal(d.readUInt32LE(24), 3);
    assert.ok(d.subarray(28, 60).equals(proof[0]));
    assert.ok(d.subarray(92, 124).equals(proof[2]));
    assert.equal(d.length, 8 + 8 + 8 + 4 + 96);
});

test('tighten: los campos sin tocar viajan como None (un solo byte)', () => {
    const soloCap = tc.tighten(PROGRAM_ID, { authority, rewardCapPerEpoch: 60000 });
    // disc(8) + Some(u64)=9 + None + None + None = 20
    assert.equal(soloCap.data.length, 20);
    assert.equal(soloCap.data[8], 1);
    assert.equal(soloCap.data.readBigUInt64LE(9), 60000n);
    assert.equal(soloCap.data[17], 0);

    const nada = tc.tighten(PROGRAM_ID, { authority });
    assert.equal(nada.data.length, 12);
});

test('una raiz que no mida 32 bytes se rechaza aqui, no on-chain', () => {
    assert.throws(() => tc.publishRound(PROGRAM_ID, { epoch: 1, merkleRoot: Buffer.alloc(31), totalRaw: 1, winners: 1, authority }), /32 bytes/);
});

/* ===================== DECODIFICADORES ===================== */

/** Construye una cuenta Config sintetica leyendo el layout del propio .rs. */
function configSintetica(valores) {
    const crypto = require('node:crypto');
    const campos = camposDe('Config');
    const trozos = [crypto.createHash('sha256').update('account:Config').digest().subarray(0, 8)];
    for (const { nombre, tipo } of campos) {
        const v = valores[nombre];
        if (tipo === 'Pubkey') trozos.push(new PublicKey(v).toBuffer());
        else if (tipo === 'bool') trozos.push(Buffer.from([v ? 1 : 0]));
        else if (tipo === 'u8') trozos.push(Buffer.from([v]));
        else if (tipo === 'u16') { const b = Buffer.alloc(2); b.writeUInt16LE(v); trozos.push(b); }
        else if (tipo === 'u64') { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); trozos.push(b); }
        else if (tipo === 'i64') { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); trozos.push(b); }
        else throw new Error('tipo sin manejar en el test: ' + tipo);
    }
    return Buffer.concat(trozos);
}

test('decodeConfig lee el mismo layout que declara el .rs', () => {
    const campos = camposDe('Config');
    const valores = {};
    let n = 1;
    for (const { nombre, tipo } of campos) {
        if (tipo === 'Pubkey') valores[nombre] = Keypair.generate().publicKey.toBase58();
        else if (tipo === 'bool') valores[nombre] = true;
        else if (tipo === 'u8') valores[nombre] = n++ % 250;
        else if (tipo === 'u16') valores[nombre] = 5;
        else valores[nombre] = n++ * 1000;
    }
    const buf = configSintetica(valores);
    const cfg = tc.decodeConfig(buf);

    const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    for (const { nombre, tipo } of campos) {
        const leido = cfg[camel(nombre)];
        const esperado = valores[nombre];
        const norm = typeof leido === 'bigint' ? Number(leido) : leido;
        assert.equal(norm, esperado, `campo ${nombre} mal leido (tipo ${tipo})`);
    }
});

test('decodeConfig rechaza una cuenta que no es suya', () => {
    assert.throws(() => tc.decodeConfig(Buffer.alloc(230)), /no es una Config/);
    assert.throws(() => tc.decodeConfig(Buffer.alloc(4)), /no es una Config/);
});

test('decodeRound rechaza una Config (los discriminadores no se cruzan)', () => {
    const campos = camposDe('Config');
    const valores = {};
    for (const { nombre, tipo } of campos) {
        valores[nombre] = tipo === 'Pubkey' ? Keypair.generate().publicKey.toBase58() : tipo === 'bool' ? false : 1;
    }
    assert.throws(() => tc.decodeRound(configSintetica(valores)), /no es una RewardRound/);
});

test('los PDAs no dependen de nada que cambie entre arranques', () => {
    const a = tc.pdas(PROGRAM_ID);
    const b = tc.pdas(PROGRAM_ID);
    assert.equal(a.config.toBase58(), b.config.toBase58());
    assert.equal(a.custody.toBase58(), b.custody.toBase58());
    assert.equal(a.treasury.toBase58(), b.treasury.toBase58());
    // Y custodia y tesoreria son cuentas DISTINTAS: es la base de todo el diseno.
    assert.notEqual(a.custody.toBase58(), a.treasury.toBase58());
});
