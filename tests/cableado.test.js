/*
 * Tests del CABLEADO entre el juego y el leaderboard diario.
 *
 * El camino de una kill hasta el premio pasa por cuatro sitios:
 *
 *   room-loop.js   ctx.econ.botKill(nombre, tester, payWallet)
 *   index.js       econLocal.botKill  -> leaderboard.recordKill(wallet, nombre)
 *   index.js       econProxy.botKill  -> notify('econ.botKill', {..., wallet})   [rol host]
 *   index.js       ipc.handle('econ.botKill') -> econLocal.botKill(..., p.wallet) [rol director]
 *
 * Si alguien quita la wallet de cualquiera de esos cuatro puntos, el juego sigue
 * funcionando exactamente igual: las kills se cuentan, las partidas se pagan, nadie
 * ve un error. Lo unico que pasa es que el leaderboard diario se queda vacio para
 * siempre y los premios dejan de repartirse en silencio. Y en el split multiproceso
 * puede romperse solo en el camino del IPC, asi que en mono parece que va bien.
 *
 * No hay forma de probar esto de verdad sin una wallet firmando una entrada de pago,
 * asi que se comprueba sobre el codigo. Es tosco, pero un test tosco que salta es
 * mejor que un fallo elegante que nadie ve en tres meses.
 *
 *   node --test "tests/*.test.js"
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const lee = (f) => fs.readFileSync(path.join(__dirname, '..', 'server', f), 'utf8');
const INDEX = lee('index.js');
const ROOM_LOOP = lee('room-loop.js');

/** El cuerpo de una funcion/metodo, para no buscar a ciegas por todo el fichero. */
function cuerpoDe(src, firma) {
    const i = src.indexOf(firma);
    assert.ok(i >= 0, 'no encuentro `' + firma + '` — ¿se ha renombrado?');
    return src.slice(i, i + 900);
}

test('el modulo del leaderboard esta enchufado en el servidor', () => {
    assert.match(INDEX, /require\('\.\/leaderboard\.js'\)/, 'index.js no carga leaderboard.js');
    assert.match(INDEX, /require\('\.\/rewards\.js'\)/, 'index.js no carga rewards.js');
});

test('room-loop pasa la wallet del matador al contar la kill', () => {
    // Sin la wallet, el nombre no sirve: no es un sitio al que mandar tokens.
    assert.match(
        ROOM_LOOP,
        /ctx\.econ\.botKill\([^)]*payWallet/,
        'room-loop.js llama a econ.botKill sin la payWallet del matador'
    );
});

test('el director apunta la kill en el leaderboard diario', () => {
    const cuerpo = cuerpoDe(INDEX, 'botKill(name, tester, wallet)');
    assert.match(cuerpo, /leaderboard\.recordKill\(wallet/, 'econLocal.botKill no registra la kill del dia');
    assert.match(cuerpo, /!tester/, 'los testers y bots no deben puntuar en el leaderboard diario');
});

test('el pico de masa del dia tambien llega con su wallet', () => {
    // Es el desempate cuando dos jugadores acaban con las mismas kills.
    const cuerpo = cuerpoDe(INDEX, 'function applyPeakMass(');
    assert.match(cuerpo, /leaderboard\.recordPeak\(wallet/, 'applyPeakMass no registra el pico del dia');
    assert.match(cuerpo, /!isTester/, 'los testers no deben puntuar');
    assert.match(INDEX, /function flushPeakMass[\s\S]{0,400}payWallet/, 'flushPeakMass no le pasa la wallet a applyPeakMass');
});

test('el camino del IPC lleva la wallet en los dos sentidos (split multiproceso)', () => {
    // En rol host el evento viaja por IPC. Si la wallet se cae aqui, en mono todo
    // funciona y en produccion —que va con Director+hosts— el leaderboard se queda
    // vacio sin que nada falle.
    const proxy = cuerpoDe(INDEX, "botKill(name, tester, wallet) { hostIpc.notify");
    assert.match(proxy, /wallet:\s*wallet\s*\|\|\s*null/, 'econProxy.botKill no manda la wallet por IPC');

    // El patron no puede pararse en el primer ")": el handler es `(p) => ...`, asi
    // que hay parentesis antes de llegar a p.wallet.
    assert.match(INDEX, /ipc\.handle\('econ\.botKill'[\s\S]{0,140}p\.wallet/, 'el handler del director ignora la wallet que llega por IPC');
    assert.match(INDEX, /ipc\.handle\('econ\.peakMass'[\s\S]{0,160}p\.wallet/, 'el handler de peakMass ignora la wallet');
    assert.match(INDEX, /notify\('econ\.peakMass',[\s\S]{0,200}payWallet/, 'el proxy de peakMass no manda la wallet');
});

test('el ciclo de premios solo lo arranca el director', () => {
    // Dos procesos publicando la misma epoca serian dos transacciones, y la segunda
    // fallaria con la cuenta de la ronda ya creada.
    assert.match(INDEX, /PW_ROLE !== 'host'\)\s*rewards\.arranca/, 'rewards.arranca no esta limitado al director');
});

test('los endpoints publicos de la tesoreria siguen existiendo', () => {
    // Son la prueba, no un extra: si se caen, la unica forma de comprobar el reparto
    // es fiarse de lo que diga yo.
    for (const ruta of ['/api/treasury', '/api/leaderboard', '/api/leaderboard/chain', '/api/rewards']) {
        assert.ok(INDEX.includes("'" + ruta + "'"), 'falta el endpoint ' + ruta);
    }
    assert.match(INDEX, /urlPath\.startsWith\('\/api\/rewards\/'\)/, 'falta el endpoint de una ronda concreta');
    assert.match(INDEX, /urlPath\.startsWith\('\/api\/leaderboard\/'\)/, 'falta el endpoint de un dia concreto');
});

test('ningun endpoint de tesoreria pide la clave de admin', () => {
    // Un dato que hay que pedir por privado no es una prueba, es una promesa.
    const trozo = INDEX.slice(INDEX.indexOf("urlPath === '/api/treasury'") - 4000, INDEX.indexOf("urlPath === '/api/treasury'") + 500);
    assert.ok(!/ADMIN_KEY/.test(trozo), 'algun endpoint publico de tesoreria esta detras de la clave de admin');
});

/* ── A que bolsa va cada euro ──────────────────────────────────────────────────
 *
 * Hay dos bolsas y NO son intercambiables:
 *
 *   staking   — todo lo que recauda el juego. Vuelve a quien inmoviliza $PILL.
 *   tesoreria — solo fund(), o sea los tokens de la compra inicial. Paga el top 10.
 *
 * Cambiar un `rakeStaking` por un `rakeTesoreria` no rompe nada, no da ningun
 * error y no lo nota nadie: simplemente ese dinero deja de llegar a los stakers.
 * Por eso se fija aqui.
 */

test('la comision del bote de arcade va al staking', () => {
    const cuerpo = cuerpoDe(ROOM_LOOP, 'const comision = Math.floor(totalPot');
    assert.match(cuerpo, /rakeStaking\(comision/, 'la comision de arcade no va al pozo del staking');
    assert.ok(!/rakeTesoreria\(comision/.test(cuerpo), 'la comision de arcade esta yendo a la tesoreria');
});

test('las partes del bote que nadie reclama van al staking', () => {
    // Un bote de 35 jugadores con 4 wallets en el top 10 deja el resto sin dueño.
    const cuerpo = cuerpoDe(ROOM_LOOP, 'const sinRepartir = repartible - repartido');
    assert.match(cuerpo, /rakeStaking\(sinRepartir/, 'lo no reclamado del bote no va al staking');
});

test('el bote repartido es el bote menos la comision', () => {
    // Si el reparto se calculase sobre `totalPot` se prometeria mas de lo que queda
    // en la sala y el ultimo del top 10 cobraria de menos o nada.
    assert.match(ROOM_LOOP, /const repartible = totalPot - comision;/, 'el reparto no descuenta la comision');
    assert.ok(!/repartible \* PESOS\[i\] \/ 100[\s\S]{0,80}totalPot \* PESOS/.test(ROOM_LOOP));
    assert.match(ROOM_LOOP, /Math\.floor\(repartible \* PESOS\[i\]/, 'el reparto no se calcula sobre el bote repartible');
});

test('el exit fee de classic va al staking, tanto en sala como al desconectar', () => {
    assert.match(ROOM_LOOP, /rakeStaking\(fee, 'exit fee /, 'el exit fee de la sala no va al staking');
    assert.match(INDEX, /rake\.alStaking\(fee, 'exit fee /, 'el exit fee del cashout no va al staking');
});

test('la entrada del que no vuelve a tiempo va al staking', () => {
    const cuerpo = cuerpoDe(INDEX, 'graceExpired(econ) {\n        if (!econ');
    assert.match(cuerpo, /rake\.alStaking\(econ\.carry/, 'lo que llevaba el desconectado no va al staking');
    assert.ok(!/addToPot|bote/.test(cuerpo.split('\n')[2] || ''), 'no debe volver al bote de la sala');
});

test('la comision de arcade tiene un tope duro', () => {
    // Es el unico porcentaje que sale del bolsillo de los jugadores, y viene de una
    // variable de entorno. Sin tope, un ARCADE_RAKE_PCT=95 mal escrito se queda casi
    // con el bote entero y el reparto sigue "funcionando".
    assert.match(
        INDEX,
        /ARCADE_RAKE_PCT = Math\.max\(0, Math\.min\(50, parseFloat\(process\.env\.ARCADE_RAKE_PCT\) \|\| 5\)\)/,
        'ARCADE_RAKE_PCT no esta acotado entre 0 y 50'
    );
    assert.match(ROOM_LOOP, /ctx\.ARCADE_RAKE_PCT/, 'room-loop no lee el porcentaje del contexto');
    assert.match(INDEX, /addToPot, sendEcon[\s\S]{0,200}ARCADE_RAKE_PCT/, 'ARCADE_RAKE_PCT no se pasa al contexto de la sala');
});

/* ── El campo de la clave de admin ─────────────────────────────────────────────
 *
 * Tenia maxlength="32" y la recomendacion de generar la clave es
 * `openssl rand -hex 32`, que da 32 BYTES = 64 caracteres. El navegador cortaba
 * la clave por la mitad al pegarla y mandaba los 32 primeros, asi que el panel
 * decia "wrong key" con la clave correcta delante. Nada fallaba, nada se
 * loguearba: solo no se podia entrar.
 */

test('el campo de la clave admite una clave de 32 bytes en hex', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'server', 'admin.html'), 'utf8');
    const m = html.match(/<input id="key"[^>]*maxlength="(\d+)"/);
    if (m) {
        assert.ok(parseInt(m[1], 10) >= 64,
            `maxlength=${m[1]} corta una clave de "openssl rand -hex 32" (64 caracteres) sin avisar`);
    }
});
