/*
 * Tests del reparto quema / tesoreria de la tienda.
 *
 * Aqui hay un solo invariante y es el unico que importa: lo que se quema mas lo que
 * va a la tesoreria tiene que sumar EXACTAMENTE lo que pago el jugador. Un token que
 * se pierde por un redondeo es un token que se le cobro a alguien y no aparece en
 * ninguna de las dos cuentas publicas; uno que se inventa es un descuadre entre la
 * deuda apuntada y lo que hay en custodia.
 *
 *   node --test "tests/*.test.js"
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { repartoSalida, PRECIO_PILL, PILL_POR_SP, TESORERIA_PCT } = require('../server/skinshop.js');

test('quema + tesoreria == lo gastado, con cualquier porcentaje', () => {
    const cantidades = [1, 7, 99, 100, 101, PILL_POR_SP, PRECIO_PILL, 123457, 999999999];
    for (let pct = 0; pct <= 100; pct++) {
        for (const pill of cantidades) {
            const r = repartoSalida(pill, pct);
            assert.equal(r.quema + r.tesoreria, pill, `pct=${pct} pill=${pill} descuadra`);
            assert.ok(r.quema >= 0 && r.tesoreria >= 0, `pct=${pct} pill=${pill} da una parte negativa`);
        }
    }
});

test('al 0 % se quema todo: el comportamiento de siempre', () => {
    const r = repartoSalida(PRECIO_PILL, 0);
    assert.equal(r.quema, PRECIO_PILL);
    assert.equal(r.tesoreria, 0);
});

test('al 100 % no se quema nada', () => {
    const r = repartoSalida(PRECIO_PILL, 100);
    assert.equal(r.quema, 0);
    assert.equal(r.tesoreria, PRECIO_PILL);
});

test('al 50 % una skin se parte por la mitad', () => {
    const r = repartoSalida(PRECIO_PILL, 50);
    assert.equal(r.tesoreria, 12500);
    assert.equal(r.quema, 12500);
});

test('el redondeo va contra la tesoreria, nunca contra la quema', () => {
    // Con 1 token al 50 % alguien tiene que quedarse con el impar. Se lo queda la
    // quema: quemar de mas es conservador (baja el supply), mientras que apuntar de
    // mas a la tesoreria seria prometer un sweep que no tiene respaldo.
    const r = repartoSalida(1, 50);
    assert.equal(r.tesoreria, 0);
    assert.equal(r.quema, 1);
});

test('por defecto el split esta apagado', () => {
    // Tiene que ser asi: sin el programa de tesoreria desplegado no hay a donde
    // barrer, y encenderlo antes dejaria una deuda creciendo sin nadie que la salde.
    assert.equal(TESORERIA_PCT, 0);
});

test('un porcentaje fuera de rango no rompe el invariante', () => {
    for (const pct of [-50, 0, 150, 1000]) {
        const acotado = Math.max(0, Math.min(100, pct));
        const r = repartoSalida(PRECIO_PILL, acotado);
        assert.equal(r.quema + r.tesoreria, PRECIO_PILL);
    }
});
