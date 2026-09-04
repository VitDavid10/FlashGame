/*
 * Tests de las dos colas del rake.
 *
 * Lo que importa aqui es que cada euro acabe en la bolsa que le toca, porque las dos
 * tienen destinatarios distintos: lo del staking va a quien inmoviliza $PILL y lo de
 * la tesoreria financia los premios del top 10. Un apunte en la cola equivocada no da
 * ningun error — simplemente le paga a quien no era.
 *
 *   node --test "tests/*.test.js"
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-rake-'));
process.env.LB_DIR = TMP;
const rake = require('../server/rake.js');

test('las dos colas son independientes', () => {
    rake.alStaking(1000, 'exit fee');
    rake.aTesoreria(500, 'comision arcade');
    const e = rake.estado();
    assert.equal(e.pendienteStaking, 1000);
    assert.equal(e.pendienteTesoreria, 500);
});

test('los apuntes se acumulan', () => {
    rake.alStaking(250, 'tienda');
    rake.aTesoreria(125, 'entrada perdida');
    const e = rake.estado();
    assert.equal(e.pendienteStaking, 1250);
    assert.equal(e.pendienteTesoreria, 625);
});

test('cero y negativos no apuntan nada', () => {
    const antes = rake.estado();
    rake.alStaking(0, 'x'); rake.alStaking(-100, 'x');
    rake.aTesoreria(0, 'x'); rake.aTesoreria(-50, 'x');
    const d = rake.estado();
    assert.equal(d.pendienteStaking, antes.pendienteStaking);
    assert.equal(d.pendienteTesoreria, antes.pendienteTesoreria);
});

test('cada apunte deja constancia de su motivo', () => {
    // Sin el motivo, un dia hay 40.000 PILL en una cola y nadie sabe de donde salieron.
    const e = rake.estado();
    const motivos = e.ultimos.map(m => m.motivo);
    assert.ok(motivos.includes('exit fee'));
    assert.ok(motivos.includes('comision arcade'));
    assert.ok(e.ultimos.every(m => m.destino === 'stake' || m.destino === 'tesoreria'));
});

test('sin programa configurado no se barre nada, pero la deuda se queda', async () => {
    const antes = rake.estado();
    const solanaFalso = { canWithdraw: () => true, authorityPubkey: () => 'x', pillToRaw: (n) => BigInt(n), sendInstructions: async () => 'sig' };
    await rake.barre(solanaFalso, {}, '', null);
    const d = rake.estado();
    assert.equal(d.pendienteStaking, antes.pendienteStaking, 'la deuda no se pierde');
    assert.equal(d.pendienteTesoreria, antes.pendienteTesoreria);
});

test('por debajo del minimo no compensa el gas', async () => {
    const enviadas = [];
    const solanaFalso = {
        canWithdraw: () => true, authorityPubkey: () => 'auth', pillToRaw: (n) => BigInt(n),
        sendInstructions: async (ix) => { enviadas.push(ix); return 'sig'; },
    };
    const tcFalso = { sweep: () => 'ixTes' };
    const stFalso = { PROGRAMA: 'p', ixFund: () => 'ixStake' };

    // Una cola nueva y pequeña.
    const TMP2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-rake2-'));
    const antesDir = process.env.LB_DIR;
    process.env.LB_DIR = TMP2;
    delete require.cache[require.resolve('../server/rake.js')];
    const r2 = require('../server/rake.js');

    r2.alStaking(r2.MINIMO - 1, 'poco');
    await r2.barre(solanaFalso, tcFalso, 'programa', null, stFalso);
    assert.equal(enviadas.length, 0, 'no deberia haber mandado nada');
    assert.equal(r2.estado().pendienteStaking, r2.MINIMO - 1, 'y la deuda sigue ahi');

    process.env.LB_DIR = antesDir;
    delete require.cache[require.resolve('../server/rake.js')];
    fs.rmSync(TMP2, { recursive: true, force: true });
});

test('se barre a menudo pero se reparte despacio', () => {
    /*
     * Son dos tiempos distintos y es LA confusion facil de este modulo:
     *
     *   MINIMO/CADA_MS  cada cuanto el dinero ENTRA en la boveda
     *   GOTEO_SECS      en cuanto tiempo se REPARTE lo que ya esta dentro
     *
     * Juntarlos —barrer una vez por semana— daria el mismo reparto pero dejaria siete
     * dias de recaudacion en la wallet caliente en vez de unas horas. Este test fija
     * que el goteo es MUCHO mas largo que el barrido, que es lo que hace que las dos
     * cosas se puedan tener a la vez.
     */
    const barridoSecs = (parseInt(process.env.RAKE_SWEEP_MIN, 10) || 360) * 60;
    assert.ok(rake.GOTEO_SECS >= barridoSecs * 12,
        `el goteo (${rake.GOTEO_SECS}s) tiene que ser mucho mayor que el barrido (${barridoSecs}s): `
        + 'si se acercan, cada barrido reparte casi de golpe y se puede stakear justo antes');
    assert.equal(rake.GOTEO_SECS, 7 * 24 * 3600, 'el goteo es de una semana');
});

test('cada cola va a su instruccion: staking al pozo, tesoreria al sweep', async () => {
    const TMP3 = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-rake3-'));
    const antesDir = process.env.LB_DIR;
    process.env.LB_DIR = TMP3;
    delete require.cache[require.resolve('../server/rake.js')];
    const r3 = require('../server/rake.js');

    const llamadas = [];
    const solanaFalso = {
        canWithdraw: () => true, authorityPubkey: () => 'auth', pillToRaw: (n) => BigInt(n),
        sendInstructions: async (ix) => { llamadas.push(ix[0]); return 'sig' + llamadas.length; },
    };
    const tcFalso = {
        sweep: (prog, o) => ({ tipo: 'sweep', amount: o.amountRaw }),
    };
    // El pozo del staking va por su propio adaptador desde que el staking puede ser
    // un contrato aparte. Se inyecta igual que el cliente de la tesoreria.
    const stFalso = {
        PROGRAMA: 'programa-staking',
        ixFund: (o) => ({ tipo: 'fundStakeRewards', amount: o.amountRaw, dur: o.durationSecs }),
    };

    r3.alStaking(50000, 'exit fees del dia');
    r3.aTesoreria(30000, 'comision arcade');
    const hecho = await r3.barre(solanaFalso, tcFalso, 'programa', null, stFalso);

    assert.equal(llamadas.length, 2);
    const stake = llamadas.find(x => x.tipo === 'fundStakeRewards');
    const tes = llamadas.find(x => x.tipo === 'sweep');
    assert.ok(stake, 'lo del staking tiene que ir por fund_stake_rewards');
    assert.ok(tes, 'lo de la tesoreria por sweep');
    assert.equal(stake.amount, 50000n);
    assert.equal(tes.amount, 30000n);
    assert.equal(stake.dur, r3.GOTEO_SECS, 'el goteo impide stakear justo antes de cada barrido');

    // Y las colas quedan a cero, con los acumulados al dia.
    const e = r3.estado();
    assert.equal(e.pendienteStaking, 0);
    assert.equal(e.pendienteTesoreria, 0);
    assert.equal(e.totalStaking, 50000);
    assert.equal(e.totalTesoreria, 30000);
    assert.ok(hecho.stake && hecho.tesoreria);

    process.env.LB_DIR = antesDir;
    delete require.cache[require.resolve('../server/rake.js')];
    fs.rmSync(TMP3, { recursive: true, force: true });
});

test('si una transaccion falla, esa deuda se queda entera', async () => {
    const TMP4 = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-rake4-'));
    const antesDir = process.env.LB_DIR;
    process.env.LB_DIR = TMP4;
    delete require.cache[require.resolve('../server/rake.js')];
    const r4 = require('../server/rake.js');

    // El staking falla, la tesoreria pasa: cada cola va por su lado.
    const solanaFalso = {
        canWithdraw: () => true, authorityPubkey: () => 'auth', pillToRaw: (n) => BigInt(n),
        sendInstructions: async (ix) => {
            if (ix[0].tipo === 'fundStakeRewards') throw new Error('RPC caido');
            return 'sig';
        },
    };
    const tcFalso = { sweep: () => ({ tipo: 'sweep' }) };
    const stFalso = { PROGRAMA: 'p', ixFund: () => ({ tipo: 'fundStakeRewards' }) };

    r4.alStaking(40000, 'x');
    r4.aTesoreria(20000, 'y');
    await r4.barre(solanaFalso, tcFalso, 'programa', null, stFalso);

    const e = r4.estado();
    assert.equal(e.pendienteStaking, 40000, 'lo que fallo sigue pendiente y se reintentara');
    assert.equal(e.pendienteTesoreria, 0, 'lo que salio se descuenta');

    process.env.LB_DIR = antesDir;
    delete require.cache[require.resolve('../server/rake.js')];
    fs.rmSync(TMP4, { recursive: true, force: true });
});

/* ===================== EL RAKE POR DIA ===================== */

/*
 * Es el numero que decide el premio del leaderboard, y el porque importa:
 *
 * En classic la entrada SE CONVIERTE en tu carry (game-host.js:384) y quien gana la
 * sala con 5 kills cobra SIN fee (room-loop.js:332). Asi que veinte wallets propias
 * entrando juntas, una matando a las otras diecinueve, recuperan las veinte entradas
 * ENTERAS: el ataque cuesta cero. Medir el premio por lo cobrado en entradas no
 * defiende de nada.
 *
 * El rake si es infalsificable: es lo que la casa se queda, y jugando contra ti mismo
 * eso da cero — el ganador no paga fee y los muertos no llevaban nada encima.
 */

test('el rake se acumula por dia UTC', () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const antes = rake.delDia(hoy);
    rake.alStaking(500, 'exit fee de prueba');
    assert.equal(rake.delDia(hoy), antes + 500);
});

test('un dia sin rake da 0, no undefined', () => {
    // Con undefined, `rake * FACTOR` daria NaN y el bote se colaria como "sin acotar"
    // en vez de como "no hay premio".
    assert.equal(rake.delDia('1999-01-01'), 0);
    assert.equal(typeof rake.delDia('1999-01-01'), 'number');
});

test('EL ATAQUE: jugar contra uno mismo no deja rake, luego no da premio', () => {
    const TMP5 = fs.mkdtempSync(path.join(os.tmpdir(), 'pillwars-atk-'));
    const antesDir = process.env.LB_DIR;
    process.env.LB_DIR = TMP5;
    delete require.cache[require.resolve('../server/rake.js')];
    const r5 = require('../server/rake.js');
    const hoy = new Date().toISOString().slice(0, 10);

    // 20 wallets mias entran a 1.160: 23.200 PILL de carrys. Una mata a las otras 19
    // y gana la sala -> cashout sin fee. Las 19 muertas salen con carry 0, tampoco
    // pagan. La casa no se queda NADA: no hay ni un apunte de rake.
    assert.equal(r5.delDia(hoy), 0, 'jugar contra uno mismo no puede dejar rake');

    // Con jugadores de verdad la mayoria NO gana la sala, asi que pagan su exit fee.
    r5.alStaking(Math.floor(1160 * 0.5), 'exit fee sin kills');
    r5.alStaking(Math.floor(1160 * 0.2), 'exit fee con una kill');
    assert.ok(r5.delDia(hoy) > 0, 'con jugadores de verdad si hay rake');

    process.env.LB_DIR = antesDir;
    delete require.cache[require.resolve('../server/rake.js')];
    fs.rmSync(TMP5, { recursive: true, force: true });
});

test('limpieza', () => {
    rake.save();
    fs.rmSync(TMP, { recursive: true, force: true });
    assert.ok(!fs.existsSync(TMP));
});

/*
 * ESTE VA APARTE del rake, pero vive aqui porque no hay un test de solana.js y el
 * fallo que fija costo veinte minutos de diagnostico en el VPS.
 *
 * TREASURY_SECRET manda sobre el fichero de la clave. Una variable mal puesta —un
 * placeholder sin sustituir, un JSON roto— tapaba una clave buena en disco y el
 * servidor decia lo mismo que si no hubiera ninguna. Ahora dice CUAL de las dos.
 */
test('una clave invalida no se confunde con no tener clave', () => {
    const RUTA = require.resolve('../server/solana.js');
    const antes = process.env.TREASURY_SECRET;

    const con = (valor) => {
        if (valor === null) delete process.env.TREASURY_SECRET;
        else process.env.TREASURY_SECRET = valor;
        delete require.cache[RUTA];
        return require('../server/solana.js');
    };

    // El placeholder literal que se quedo en el .service.
    let s = con('[1,2,3,...]');
    assert.equal(s.canWithdraw(), false);
    assert.match(s.porQueNoFirma(), /TREASURY_SECRET/,
        'tiene que decir que el problema esta en la VARIABLE, no en el fichero');
    assert.match(s.porQueNoFirma(), /JSON/);

    // Un array valido pero que no es una clave.
    s = con('[1,2,3]');
    assert.equal(s.canWithdraw(), false);
    assert.match(s.porQueNoFirma(), /64/, 'tiene que decir cuantos bytes faltan');

    // Y sin variable, que caiga al fichero sin quejarse.
    s = con(null);
    assert.equal(s.canWithdraw(), true);
    assert.equal(s.porQueNoFirma(), null);

    if (antes) process.env.TREASURY_SECRET = antes;
    delete require.cache[RUTA];
});

test('una wallet de premios mal puesta no se hace pasar por no haberla separado', () => {
    /*
     * Aqui equivocarse es mas caro que en la autoridad. Con REWARDS_SECRET malo, el
     * panel decia `rewards: null` y `rewardsAparte: false` — que es exactamente lo
     * que dice cuando NO has separado la wallet todavia. O sea: el sitio que existe
     * para demostrar desde donde salen los premios respondia lo contrario de la
     * verdad, y sin fallar.
     *
     * Y no debe caer a la autoridad: pagaria los premios desde la wallet equivocada,
     * saldria bien, y no se notaria hasta mirar el explorador semanas despues.
     */
    const RUTA = require.resolve('../server/solana.js');
    const antes = process.env.REWARDS_SECRET;

    const con = (valor) => {
        if (valor === null) delete process.env.REWARDS_SECRET;
        else process.env.REWARDS_SECRET = valor;
        delete require.cache[RUTA];
        return require('../server/solana.js');
    };

    let s = con('[1,2,3,...]');
    assert.equal(s.rewardsPubkey(), null);
    assert.match(s.porQueNoHayPremios(), /REWARDS_SECRET/,
        'tiene que decir que el problema esta en la variable de los premios');
    assert.notEqual(s.rewardsPubkey(), s.authorityPubkey(),
        'una clave rota no puede acabar pagando desde la autoridad');

    s = con('[1,2,3]');
    assert.equal(s.rewardsPubkey(), null);
    assert.match(s.porQueNoHayPremios(), /64/);

    /*
     * Sin variable si carga: por el fichero .rewards-wallet.json si esta, y si no
     * por la autoridad. Cual de los dos depende de la maquina, asi que lo que se
     * fija es lo que importa: que carga ALGO y que no da motivo, porque no haber
     * separado la wallet es una decision, no una averia.
     */
    s = con(null);
    assert.ok(s.rewardsPubkey(), 'sin variable tiene que cargar igualmente');
    assert.equal(s.porQueNoHayPremios(), null);
    assert.equal(s.rewardsAparte(), s.rewardsPubkey() !== s.authorityPubkey(),
        'rewardsAparte tiene que describir si de verdad son wallets distintas');

    if (antes) process.env.REWARDS_SECRET = antes;
    delete require.cache[RUTA];
});
