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
    await esbuild.build({
        entryPoints: [ENTRADA],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2020',
        minify: true,
        legalComments: 'none',
        outfile: SALIDA,
        // spl-token usa `Buffer` como global de Node sin importarlo: en el
        // navegador no existe y createTransferInstruction petaba con "Buffer is
        // not defined" al codificar el importe. Ver vendor-buffer-shim.js.
        inject: [path.join(RAIZ, 'scripts', 'vendor-buffer-shim.js')],
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

    /*
     * Prueba de humo: NO basta con que el bundle compile.
     *
     * La primera version compilaba, pesaba lo esperado y no tenia imports
     * sueltos... y aun asi el deposito fallaba al instante en produccion, por
     * el `Buffer` global que spl-token da por hecho. Eso no se ve mirando el
     * fichero: solo aparece al EJECUTAR el codigo.
     *
     * Y hay que ejecutarlo COMO UN NAVEGADOR. Un primer intento corria el test
     * en este mismo proceso de Node, donde Buffer es un global de serie: pasaba
     * igual de verde con y sin el arreglo, o sea que no valia para nada. Por eso
     * se lanza un proceso aparte que BORRA los globales que el navegador no
     * tiene (Buffer, process, global) antes de importar el bundle.
     */
    const tmp = path.join(path.dirname(SALIDA), '.humo.mjs');
    const test = path.join(path.dirname(SALIDA), '.humo-test.mjs');
    fs.copyFileSync(SALIDA, tmp);
    fs.writeFileSync(test, `
// Simula el navegador: fuera los globales de Node que alli no existen.
delete globalThis.Buffer; delete globalThis.process; delete globalThis.global;
const m = await import('./.humo.mjs');
const faltan = ['Connection','PublicKey','Transaction','getAssociatedTokenAddress',
  'createTransferInstruction','createAssociatedTokenAccountInstruction','getAccount',
  'TokenAccountNotFoundError'].filter(k => !m[k]);
if (faltan.length) throw new Error('el bundle no exporta: ' + faltan.join(', '));
const mint  = new m.PublicKey('Exth8VyQVuNaJdZsUjoPK3QdegdxJBYXAnzT3mP5xY1r');
const owner = new m.PublicKey('4ToGD9MyS5vxDtGGMgU2SRvmqnZ66XHmaUgKKdH65YMN');
const ata = await m.getAssociatedTokenAddress(mint, owner);
// El paso exacto que reventaba en produccion: codifica un u64, necesita Buffer.
const ix = m.createTransferInstruction(ata, ata, owner, 1000000n);
if (!ix || !ix.data || !ix.data.length) throw new Error('createTransferInstruction no devolvio datos');
new m.Transaction().add(ix);
console.log('  prueba de humo (sin globales de Node): OK, transferencia codificada en ' + ix.data.length + ' bytes');
`);
    const { status, stderr, stdout } = require('child_process').spawnSync(
        process.execPath, [test], { encoding: 'utf8' });
    try { fs.unlinkSync(tmp); fs.unlinkSync(test); } catch (_) {}
    if (status !== 0) {
        console.error('\nEl bundle compila pero NO FUNCIONA en un navegador:');
        console.error((stderr || '').split('\n').filter(l => l.trim()).slice(0, 6).join('\n'));
        console.error('\nNo se escribe el meta: corrigelo antes de commitear.');
        process.exit(1);
    }
    process.stdout.write(stdout);

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
