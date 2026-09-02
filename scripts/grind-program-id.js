/*
 * Busca un keypair cuya direccion empiece por un prefijo, como `solana-keygen grind`
 * pero sin la CLI de Solana instalada.
 *
 * Para que sirva: un holder que abre el explorador ve la direccion del programa de
 * tesoreria. Si empieza por "PiLL" es reconocible de un vistazo, y colar un contrato
 * falso con otra direccion pasa de ser facil a tener que explicar por que la direccion
 * no se parece a la de siempre. Es una defensa debil, pero gratis.
 *
 *   node scripts/grind-program-id.js PiLL
 *   node scripts/grind-program-id.js PiLL programs/pill-treasury-keypair.json
 *
 * Va en paralelo con todos los nucleos: generar un keypair ed25519 cuesta ~1 ms en
 * JS, y un prefijo de 4 caracteres son 58^4 = 11,3 millones de intentos de media.
 * En un solo hilo eso son horas; repartido entre 8 nucleos, minutos.
 */
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { Keypair } = require('@solana/web3.js');

// El alfabeto base58 no tiene 0, O, I ni l: un prefijo con esos caracteres no sale nunca.
const PROHIBIDOS = /[0OIl]/;

if (isMainThread) {
    const prefijo = process.argv[2] || 'PiLL';
    const destino = process.argv[3] || path.join(__dirname, '..', 'programs', 'pill-treasury-keypair.json');

    if (PROHIBIDOS.test(prefijo)) {
        console.error(`El prefijo "${prefijo}" tiene caracteres que base58 no usa (0, O, I, l). Prueba otro.`);
        process.exit(1);
    }

    const hilos = Math.max(1, Math.min(os.cpus().length, 16));
    const esperados = Math.pow(58, prefijo.length);
    console.error(`Buscando "${prefijo}..." con ${hilos} hilos (~${esperados.toLocaleString('es')} intentos de media)`);

    const t0 = Date.now();
    let total = 0;
    let terminado = false;
    const workers = [];

    for (let i = 0; i < hilos; i++) {
        const w = new Worker(__filename, { workerData: { prefijo } });
        workers.push(w);
        w.on('message', (msg) => {
            if (msg.tick) {
                total += msg.tick;
                const seg = (Date.now() - t0) / 1000;
                process.stderr.write(`\r  ${total.toLocaleString('es')} intentos · ${Math.round(total / seg).toLocaleString('es')}/s · ${seg.toFixed(0)}s`);
                return;
            }
            if (terminado) return;
            terminado = true;
            fs.writeFileSync(destino, JSON.stringify(msg.secret));
            const seg = ((Date.now() - t0) / 1000).toFixed(1);
            process.stderr.write('\n');
            console.log(msg.pubkey);
            console.error(`  encontrada en ${seg}s -> ${destino}`);
            for (const x of workers) x.terminate();
        });
    }
} else {
    const { prefijo } = workerData;
    let n = 0;
    for (;;) {
        const kp = Keypair.generate();
        const pub = kp.publicKey.toBase58();
        if (pub.startsWith(prefijo)) {
            parentPort.postMessage({ pubkey: pub, secret: Array.from(kp.secretKey) });
            return;
        }
        if (++n % 20000 === 0) parentPort.postMessage({ tick: 20000 });
    }
}
