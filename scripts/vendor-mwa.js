/*
 * Regenera vendor/mwa.js — Mobile Wallet Adapter (Solana Mobile) para la APP.
 *
 *   node scripts/vendor-mwa.js
 *
 * Dentro del WebView de la app no hay extensiones (window.phantom, solflare...):
 * la wallet de la Saga/Seeker (Seed Vault) se habla por MWA. Igual que
 * vendor/solana.js, el paquete se empaqueta aqui y lo sirve NUESTRO servidor:
 * nada de cargar en tiempo de ejecucion codigo de terceros justo donde se firma.
 * Sale como IIFE en window.PillMWA (la pagina lo carga solo en la app).
 * Escribe tambien vendor/mwa.meta.json con la version exacta empaquetada.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const RAIZ = path.join(__dirname, '..');
const PAQUETE = '@solana-mobile/wallet-standard-mobile';
const SALIDA = path.join(RAIZ, 'vendor', 'mwa.js');
const META = path.join(RAIZ, 'vendor', 'mwa.meta.json');

async function main() {
    const version = JSON.parse(fs.readFileSync(path.join(RAIZ, 'node_modules', PAQUETE, 'package.json'), 'utf8')).version;
    await esbuild.build({
        stdin: { contents: `export * from '${PAQUETE}';`, resolveDir: RAIZ, loader: 'js' },
        bundle: true,
        format: 'iife',
        globalName: 'PillMWA',
        platform: 'browser',
        target: 'es2020',
        minify: true,
        legalComments: 'none',
        outfile: SALIDA,
    });
    const js = fs.readFileSync(SALIDA, 'utf8');
    if (/\brequire\(["'][^"'.\/]/.test(js)) { console.error('El bundle NO es autocontenido (queda un require de paquete).'); process.exit(1); }
    // Humo: que exponga lo que usa la app.
    const ctx = { window: {}, self: {}, navigator: { userAgent: '' }, document: { createElement: () => ({}) } };
    try { new Function('window', 'self', 'navigator', 'document', js + '; window.PillMWA = PillMWA;')(ctx.window, ctx.self, ctx.navigator, ctx.document); } catch (e) { console.error('El bundle falla al cargar:', e.message); process.exit(1); }
    if (typeof (ctx.window.PillMWA || {}).LocalSolanaMobileWalletAdapterWallet !== 'function') { console.error('Falta LocalSolanaMobileWalletAdapterWallet'); process.exit(1); }
    fs.writeFileSync(META, JSON.stringify({ generado: new Date().toISOString(), esbuild: require('esbuild/package.json').version, paquetes: { [PAQUETE]: version }, bytes: js.length }, null, 2) + '\n');
    console.log('vendor/mwa.js', js.length, 'bytes,', PAQUETE, version);
}
main().catch(e => { console.error(e); process.exit(1); });
