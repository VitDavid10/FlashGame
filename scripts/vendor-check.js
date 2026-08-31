/*
 * ¿El bundle vendor/solana.js está al día con la librería instalada?
 *
 *   npm run vendor:check     → 0 si está al día, 1 si hay que regenerar
 *
 * Existe para que el ÚNICO mantenimiento extra de haber dejado de usar esm.sh
 * no dependa de acordarse: si alguien sube la versión de @solana/web3.js y no
 * relanza `npm run vendor:solana`, el navegador seguiría cargando el bundle
 * viejo indefinidamente y sin dar ningún error. Esto lo convierte en un aviso.
 *
 * Lo usa también el servidor al arrancar (server/index.js) para dejar el aviso
 * en el log, así que basta con mirar `journalctl -u pillwars` tras un deploy.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const META = path.join(RAIZ, 'vendor', 'solana.meta.json');
const BUNDLE = path.join(RAIZ, 'vendor', 'solana.js');

// Devuelve null si está todo bien, o un texto explicando qué falta.
function comprobar() {
    if (!fs.existsSync(BUNDLE)) return 'falta vendor/solana.js';
    if (!fs.existsSync(META)) return 'falta vendor/solana.meta.json';
    let meta;
    try { meta = JSON.parse(fs.readFileSync(META, 'utf8')); } catch (e) { return 'meta ilegible'; }
    const desfases = [];
    for (const [pkg, empaquetada] of Object.entries(meta.paquetes || {})) {
        let instalada = null;
        try { instalada = JSON.parse(fs.readFileSync(path.join(RAIZ, 'node_modules', pkg, 'package.json'), 'utf8')).version; }
        catch (e) { continue; }   // sin node_modules (deploy con --omit=dev): no se puede comparar, no es un fallo
        if (instalada !== empaquetada) desfases.push(pkg + ': bundle ' + empaquetada + ' vs instalada ' + instalada);
    }
    return desfases.length ? desfases.join(' · ') : null;
}

module.exports = { comprobar };

if (require.main === module) {
    const problema = comprobar();
    if (problema) {
        console.error('DESFASADO — ' + problema);
        console.error('Regenera con:  npm run vendor:solana');
        process.exit(1);
    }
    console.log('vendor/solana.js al dia con la libreria instalada.');
}
