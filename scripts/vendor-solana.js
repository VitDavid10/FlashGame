/*
 * Regenera vendor/solana.js — el bundle de Solana que sirve NUESTRO servidor.
 *
 *   npm run vendor:solana
 *
 * Antes las dos páginas que firman transacciones cargaban la librería desde
 * https://esm.sh en tiempo de ejecución (código de un tercero ejecutándose
 * dentro de nuestra web, justo en el punto donde se construye la transacción
 * que el usuario firma). Ahora el fichero es nuestro y está versionado.
 *
 * Además del bundle escribe vendor/solana.meta.json con las versiones EXACTAS
 * de node_modules con las que se generó. Eso es lo que permite que el olvido
 * típico —actualizar la librería en package.json y no regenerar el bundle— no
 * pase desapercibido: `npm run vendor:check` lo compara, y el servidor lo avisa
 * al arrancar. Sin eso, el juego seguiría sirviendo la versión vieja para
 * siempre y en silencio.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const RAIZ = path.join(__dirname, '..');
const PAQUETES = ['@solana/web3.js', '@solana/spl-token'];
const ENTRADA = path.join(RAIZ, 'scripts', 'vendor-solana-entry.js');
const SALIDA = path.join(RAIZ, 'vendor', 'solana.js');
const META = path.join(RAIZ, 'vendor', 'solana.meta.json');

// Versión REAL instalada (la de node_modules), no el rango de package.json:
// "^1.95.0" no dice qué se empaquetó de verdad.
function versionInstalada(pkg) {
    const p = path.join(RAIZ, 'node_modules', pkg, 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version;
}

function versiones() {
    const v = {};
    for (const p of PAQUETES) v[p] = versionInstalada(p);
    return v;
}

async function main() {
    fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
    const r = await esbuild.build({
        entryPoints: [ENTRADA],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2020',
        minify: true,
        legalComments: 'none',
        outfile: SALIDA,
        metafile: true,
    });
    const bytes = fs.statSync(SALIDA).size;

    // Comprobación de que el bundle se basta a sí mismo: si quedara algún
    // import por nombre de paquete ('buffer', 'bn.js'...), el navegador
    // intentaría pedirlo al servidor y daría 404 — que es justo el motivo por
    // el que no vale con copiar el fichero de node_modules a mano.
    const js = fs.readFileSync(SALIDA, 'utf8');
    const sueltos = js.match(/\bfrom\s*["'][^"'.\/][^"']*["']/g);
    if (sueltos) {
        console.error('El bundle NO es autocontenido, quedan imports externos:', sueltos.slice(0, 5));
        process.exit(1);
    }

    fs.writeFileSync(META, JSON.stringify({
        generado: new Date().toISOString(),
        esbuild: esbuild.version,
        paquetes: versiones(),
        bytes,
    }, null, 2) + '\n');

    console.log('vendor/solana.js   ' + (bytes / 1024).toFixed(1) + ' kB');
    for (const [p, v] of Object.entries(versiones())) console.log('  ' + p.padEnd(22) + v);
    console.log('\nListo. El bundle ya no depende de esm.sh.');
}

main().catch(e => { console.error(e); process.exit(1); });
