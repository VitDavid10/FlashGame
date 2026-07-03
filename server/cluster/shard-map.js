'use strict';
/*
 * shard-map — reparto determinista de combos (mode_price) entre N hosts.
 *
 * Fase 4 (split multiproceso). Cada "combo" = mode + '_' + price. Un combo vive
 * ENTERO en un host (todas sus layers), así el matchmaking del Director es un
 * simple mapa combo→hostId y el pickLayer sigue local a cada host.
 *
 * Propiedades que garantiza:
 *  - Determinista: el mismo combo cae siempre en el mismo host (dado el mismo
 *    catálogo y N). Un host que reinicia recupera exactamente sus combos.
 *  - Balanceado: reparte round-robin sobre una lista ordenada estable, así la
 *    diferencia de nº de combos entre hosts es como mucho 1.
 *  - Independiente del orden de PRICES/MODES en la llamada (se ordena dentro).
 */

// Construye la lista canónica y ordenada de combos a partir del catálogo.
// El orden estable es lo que hace el reparto reproducible entre procesos.
function listCombos(modes, prices) {
    const combos = [];
    for (const mode of modes) {
        for (const price of prices) combos.push(mode + '_' + price);
    }
    combos.sort();
    return combos;
}

// Devuelve { comboToHost: Map<combo, hostId>, hostToCombos: Map<hostId, combo[]> }
// hostId es 0..hostCount-1.
function buildShardMap(modes, prices, hostCount) {
    if (!Number.isInteger(hostCount) || hostCount < 1) {
        throw new Error('buildShardMap: hostCount debe ser un entero >= 1');
    }
    const combos = listCombos(modes, prices);
    const comboToHost = new Map();
    const hostToCombos = new Map();
    for (let h = 0; h < hostCount; h++) hostToCombos.set(h, []);
    combos.forEach((combo, i) => {
        const host = i % hostCount;
        comboToHost.set(combo, host);
        hostToCombos.get(host).push(combo);
    });
    return { comboToHost, hostToCombos };
}

// Aplica una asignación manual (combo → hostId) sobre el reparto automático de
// buildShardMap. Pensada para el panel de admin: el operador elige a mano en qué
// host vive cada combo, o lo desactiva del todo.
//  - overrides: { [combo]: hostId } — combo ausente del objeto conserva el
//    reparto automático de `base`; hostId null/fuera de rango = combo apagado
//    (no lo posee ningún host: no se crea nunca y no aparece en ningún panel).
// Devuelve la misma forma que buildShardMap: { comboToHost, hostToCombos }.
function applyOverrides(base, overrides, hostCount) {
    const comboToHost = new Map();
    const hostToCombos = new Map();
    for (let h = 0; h < hostCount; h++) hostToCombos.set(h, []);
    for (const [combo, autoHost] of base.comboToHost) {
        const has = overrides && Object.prototype.hasOwnProperty.call(overrides, combo);
        const hostId = has ? overrides[combo] : autoHost;
        if (hostId == null || !hostToCombos.has(hostId)) continue;   // apagado o host fuera de rango
        comboToHost.set(combo, hostId);
        hostToCombos.get(hostId).push(combo);
    }
    return { comboToHost, hostToCombos };
}

module.exports = { listCombos, buildShardMap, applyOverrides };
