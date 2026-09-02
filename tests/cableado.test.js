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
