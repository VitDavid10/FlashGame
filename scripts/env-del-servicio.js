/*
 * LAS VARIABLES DEL SERVICIO, TAMBIEN PARA LOS SCRIPTS DE MANO.
 *
 * En el VPS la configuracion vive en las lineas `Environment=` de
 * /etc/systemd/system/pillwars.service. systemd se las pasa al servidor, pero un
 * shell NO las hereda: `node scripts/llenar-vault.js` arranca sin ninguna.
 *
 * Eso hacia que un script dijera "STAKING_PROGRAM sin desplegar" en una maquina
 * donde el staking lleva desplegado semanas y el servidor lo usa sin problema. El
 * mensaje era cierto para el proceso y falso para el sistema, que es la peor clase
 * de mensaje: manda a revisar un despliegue que esta bien.
 *
 * Asi que se leen de donde ya estan. Reglas:
 *
 *   - Lo que YA este en el entorno manda. Poner `STAKING_PROGRAM=otro node ...`
 *     tiene que seguir sirviendo para probar contra otro contrato.
 *   - Fuera del VPS no hay fichero y esto no hace nada.
 *   - Se dice que se ha cargado y de donde. Nunca el valor: ahi van las claves.
 */
'use strict';

const fs = require('fs');

const UNIDAD = process.env.PW_SERVICE_FILE || '/etc/systemd/system/pillwars.service';

/** Los pares KEY=VALUE de las lineas Environment= no comentadas. */
function leeUnidad(ruta) {
    const out = {};
    let texto;
    try { texto = fs.readFileSync(ruta, 'utf8'); } catch (e) { return out; }
    for (const linea of texto.split(/\r?\n/)) {
        const m = /^Environment=(.+)$/.exec(linea.trim());
        if (!m) continue;                       // incluye las comentadas: empiezan por #
        const par = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(m[1]);
        if (!par) continue;
        let v = par[2].trim();
        if (v.length > 1 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1);
        out[par[1]] = v;
    }
    return out;
}

/**
 * Mete en process.env lo que falte. Devuelve los nombres que ha puesto.
 * Llamalo ANTES de requerir nada de server/, que lee el entorno al importarse.
 */
function carga({ silencio = false } = {}) {
    const pares = leeUnidad(UNIDAD);
    const puestas = [];
    for (const [k, v] of Object.entries(pares)) {
        if (process.env[k] === undefined) { process.env[k] = v; puestas.push(k); }
    }
    if (puestas.length && !silencio) {
        console.log(`Config leida de ${UNIDAD}: ${puestas.join(', ')}`);
    }
    return puestas;
}

module.exports = { carga, leeUnidad, UNIDAD };
