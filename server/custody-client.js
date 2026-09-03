/*
 * Cliente del programa pill_custody, en JS plano.
 *
 * Mismo enfoque que treasury-client.js y por la misma razon: lo que hace Anchor por
 * dentro son dos cosas simples —discriminadores sha256 y Borsh— y meter su runtime
 * entero en un proceso que corre 24/7 no compensa.
 *
 *   discriminador de instruccion = sha256("global:<nombre_snake_case>")[0..8]
 *   discriminador de cuenta      = sha256("account:<NombreStruct>")[0..8]
 *
 * CUIDADO AL TOCAR EL PROGRAMA: el orden de las cuentas tiene que ser EXACTAMENTE el
 * del struct #[derive(Accounts)]. Si se anade una cuenta en medio y no se toca esto,
 * la instruccion falla; si se anade un campo en medio de Config, decodeConfig() lee
 * basura SIN dar error. tests/custody-client.test.js comprueba las dos cosas contra
 * el .rs, que es la unica forma de que no se desincronicen en silencio.
 */
'use strict';

const crypto = require('crypto');
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');

const disc = (ns, nombre) => crypto.createHash('sha256').update(`${ns}:${nombre}`).digest().subarray(0, 8);
const ixDisc = (nombre) => disc('global', nombre);
const accDisc = (nombre) => disc('account', nombre);

const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

const CONFIG_SEED = Buffer.from('config');
const CUSTODY_SEED = Buffer.from('custody');

/** Las dos PDAs del programa. No dependen de nada que cambie entre arranques. */
function pdas(programId) {
    const p = new PublicKey(programId);
    const [config] = PublicKey.findProgramAddressSync([CONFIG_SEED], p);
    const [custody] = PublicKey.findProgramAddressSync([CUSTODY_SEED], p);
    return { config, custody };
}

function ix(programId, keys, data) {
    return new TransactionInstruction({ programId: new PublicKey(programId), keys, data });
}
const rw = (pubkey, signer = false) => ({ pubkey: new PublicKey(pubkey), isSigner: signer, isWritable: true });
const ro = (pubkey, signer = false) => ({ pubkey: new PublicKey(pubkey), isSigner: signer, isWritable: false });

/* ===================== INSTRUCCIONES ===================== */

/** Crea config y boveda. Solo la firma DEPLOYER, que va compilada en el programa. */
function initialize(programId, { mint, authority, payer }) {
    const { config, custody } = pdas(programId);
    return ix(programId, [
        rw(config), rw(custody), ro(mint), ro(authority), rw(payer, true),
        ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId), ro(SYSVAR_RENT_PUBKEY),
    ], ixDisc('initialize'));
}

/** Wallet del jugador -> boveda. La firma el jugador y nadie mas. */
function deposit(programId, { from, owner, amountRaw }) {
    const { config, custody } = pdas(programId);
    return ix(programId, [
        rw(config), rw(custody), rw(from), ro(owner, true), ro(TOKEN_PROGRAM_ID),
    ], Buffer.concat([ixDisc('deposit'), u64(amountRaw)]));
}

/*
 * Boveda -> cuenta asociada del jugador. Firman la autoridad Y el jugador.
 *
 * El destino no lo elige quien firma: es la ATA derivada de la direccion del jugador
 * y del mint, y el programa lo comprueba. Un retiro no se puede desviar.
 */
function withdraw(programId, { player, mint, authority, amountRaw }) {
    const { config, custody } = pdas(programId);
    const to = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(player), true);
    return ix(programId, [
        rw(config), rw(custody), rw(to), ro(mint), ro(player, true), ro(authority, true),
        ro(TOKEN_PROGRAM_ID), ro(ASSOCIATED_TOKEN_PROGRAM_ID),
    ], Buffer.concat([ixDisc('withdraw'), u64(amountRaw)]));
}

/* Traspaso de autoridad en dos pasos: nombrar y aceptar. En un paso, un error de un
 * caracter deja el programa sin autoridad y con el dinero de los jugadores dentro. */
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
 * Config: 8 de discriminador y detras el struct en orden de declaracion.
 * Option<Pubkey> es 1 byte de etiqueta + 32, ocupe o no.
 */
function decodeConfig(data) {
    const buf = Buffer.from(data);
    if (!buf.subarray(0, 8).equals(accDisc('Config'))) {
        throw new Error('esa cuenta no es una Config de pill_custody');
    }
    let o = 8;
    const pk = () => { const v = new PublicKey(buf.subarray(o, o + 32)).toBase58(); o += 32; return v; };
    const authority = pk();
    const tienePending = buf[o] === 1; o += 1;
    const pending = new PublicKey(buf.subarray(o, o + 32)).toBase58(); o += 32;
    const mint = pk();
    const configBump = buf[o]; o += 1;
    const custodyBump = buf[o]; o += 1;
    const totalDeposited = buf.readBigUInt64LE(o); o += 8;
    const totalWithdrawn = buf.readBigUInt64LE(o); o += 8;
    return {
        authority,
        pendingAuthority: tienePending ? pending : null,
        mint, configBump, custodyBump,
        totalDeposited: totalDeposited.toString(),
        totalWithdrawn: totalWithdrawn.toString(),
    };
}

module.exports = {
    pdas, initialize, deposit, withdraw, transferAuthority, acceptAuthority,
    decodeConfig, ixDisc, accDisc, CONFIG_SEED, CUSTODY_SEED,
};
