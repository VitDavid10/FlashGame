'use strict';
// Smoke 4a.4.5: partida de PAGO completa end-to-end en el split multiproceso.
//
// Director + 2 hosts. Dos jugadores (wallets con firma nacl real) pagan la
// entrada de classic_5$ (50k PILL cada uno) en el HOST, la partida arranca
// (forceStart vía admin del host), spawnean y juegan (snapshots reales), y
// salen VIVOS en plena partida → cashout classic con exit fee 20% (0 kills):
// +40k al warbank de cada uno. Todo el dinero cruza por IPC host→director.
// Cuadre exacto: 1M − 50k (entrada) + 40k (cashout) = 990k por cabeza.
//
// (El caso "morir con carry → bote" está cubierto unitariamente en _test-econ;
// aquí se verifica el CANAL: los eventos económicos de una partida real servida
// por un host forkeado mueven el warbank del Director y cuadran al PILL.)
//
// Ejecutar: node server/cluster/_smoke-e2e-pay.js   (~15s)
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const nacl = require('tweetnacl');
const { PublicKey } = require('@solana/web3.js');
const WebSocket = require('ws');

const INDEX = path.join(__dirname, '../index.js');
const WARBANK_FILE = path.join(__dirname, '../warbalances.json');
const DIR_PORT = 8095;
const RATE = 10000;
const FEE = 5 * RATE;
const START = 1000000;
const CASHOUT_NET = FEE - Math.floor(FEE * 20 / 100);   // exit fee 20% con 0 kills

function makeWallet() {
    const kp = nacl.sign.keyPair();
    return { kp, addr: new PublicKey(Buffer.from(kp.publicKey)).toBase58() };
}
function signedEntry(w, comboKey, fee) {
    const ts = Date.now();
    const message = `PillWars enter ${comboKey} paying ${fee} PILL @ ${ts}`;
    const signature = Array.from(nacl.sign.detached(new TextEncoder().encode(message), w.kp.secretKey));
    return { wallet: w.addr, ts, message, signature };
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
    if (ok) pass++; else fail++;
    console.log(' ', ok ? 'PASS' : 'FAIL', name + (ok || !detail ? '' : ' → ' + detail));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function balanceOf(addr) {
    return (await (await fetch(`http://localhost:${DIR_PORT}/api/warbalance?wallet=${addr}`)).json()).pill;
}

// Cliente de juego mínimo: join firmado, ready al matchStart, cuenta snapshots.
function gameClient(port, joinMsg) {
    const st = { welcome: null, matchStart: false, snaps: 0, err: null };
    st.ws = new WebSocket(`ws://localhost:${port}`);
    st.ws.on('open', () => st.ws.send(JSON.stringify(joinMsg)));
    st.ws.on('message', (data) => {
        let m; try { m = JSON.parse(data); } catch (e) { return; }
        if (m.t === 'welcome') st.welcome = m;
        else if (m.t === 'payRequired') st.err = 'payRequired: ' + m.reason;
        else if (m.t === 'matchStart') { st.matchStart = true; st.ws.send(JSON.stringify({ t: 'ready' })); }
        else if (m.t === 'snap' || m.t === 'events') st.snaps++;
    });
    st.ws.on('error', e => { st.err = e.message; });
    return st;
}

const A = makeWallet(), B = makeWallet();
const hadFile = fs.existsSync(WARBANK_FILE);
const backup = hadFile ? fs.readFileSync(WARBANK_FILE) : null;
fs.writeFileSync(WARBANK_FILE, JSON.stringify({ balances: { [A.addr]: START, [B.addr]: START }, sigs: {} }));

const director = spawn(process.execPath, [INDEX], {
    env: { ...process.env, PORT: String(DIR_PORT), PW_ROLE: 'director', PW_HOST_COUNT: '2', PILL_PER_DOLLAR: String(RATE), ADMIN_KEY: '1234' },
    stdio: ['ignore', 'pipe', 'pipe'],
});
director.logBuf = '';
director.stdout.on('data', d => { director.logBuf += d; });
director.stderr.on('data', d => { director.logBuf += d; });

(async () => {
    try {
        await sleep(3000);

        // 1) matchmaking: qué host sirve classic_5$
        const match = await (await fetch(`http://localhost:${DIR_PORT}/match?mode=classic&price=5$`)).json();
        check('match resuelve host para classic_5$', match.ok === true, JSON.stringify(match));

        // 2) dos entradas pagadas (débito por IPC en el warbank del Director)
        const cliA = gameClient(match.port, { t: 'join', mode: 'classic', room: '5$', name: 'PayBotA', pay: signedEntry(A, 'classic_5$', FEE) });
        await sleep(400);
        const cliB = gameClient(match.port, { t: 'join', mode: 'classic', room: '5$', name: 'PayBotB', pay: signedEntry(B, 'classic_5$', FEE) });
        await sleep(1500);
        check('A y B dentro (welcome)', !!cliA.welcome && !!cliB.welcome, JSON.stringify({ a: cliA.err || 'ok', b: cliB.err || 'ok' }));
        const bA1 = await balanceOf(A.addr), bB1 = await balanceOf(B.addr);
        check(`entradas debitadas en el Director (A=${bA1}, B=${bB1})`, bA1 === START - FEE && bB1 === START - FEE);

        // 3) forzar el inicio vía admin DEL HOST (la sala vive allí)
        const admin = new WebSocket(`ws://localhost:${match.port}`);
        admin.on('open', () => admin.send(JSON.stringify({ t: 'admin', key: '1234', cmd: 'forceStart', room: 'classic_5$_L1' })));
        await sleep(2000);
        check('partida arrancada en el host (matchStart→ready)', cliA.matchStart && cliB.matchStart);

        // 4) la partida corre de verdad en el host (snapshots/eventos fluyen)
        await sleep(2000);
        check(`snapshots del host fluyendo (A=${cliA.snaps}, B=${cliB.snaps})`, cliA.snaps > 20 && cliB.snaps > 20);

        // 5) B sale VIVO en plena partida → cashout classic vía IPC (fee 20%)
        cliB.ws.close();
        await sleep(1500);
        const bB2 = await balanceOf(B.addr);
        check(`cashout de B por IPC (${bB1} → ${bB2}, +${CASHOUT_NET})`, bB2 === START - FEE + CASHOUT_NET);

        // 6) A sale también → mismo cashout; cuadre final exacto
        cliA.ws.close();
        await sleep(1500);
        const bA2 = await balanceOf(A.addr);
        check(`cashout de A por IPC (${bA1} → ${bA2}, +${CASHOUT_NET})`, bA2 === START - FEE + CASHOUT_NET);

        // 7) la partida entera la sirvió el host: el Director sigue sin salas
        const dh = await (await fetch(`http://localhost:${DIR_PORT}/api/health`)).json();
        check(`director sin salas tras la partida (rooms=${dh.rooms})`, dh.rooms === 0);
        const cashouts = (director.logBuf.match(/Cashout classic/g) || []).length;
        check(`el Director registró los 2 cashouts en su log (${cashouts})`, cashouts === 2);

        try { admin.close(); } catch (e) {}
    } catch (e) {
        fail++;
        console.log('  FAIL (excepción):', e.message);
    } finally {
        try { director.kill(); } catch (e) {}
        await sleep(500);
        try { if (hadFile) fs.writeFileSync(WARBANK_FILE, backup); else fs.unlinkSync(WARBANK_FILE); } catch (e) {}
    }
    console.log(`\n${fail === 0 ? 'OK' : 'FALLOS'}: ${pass} pass, ${fail} fail`);
    if (fail > 0) console.log('\n--- director log ---\n' + director.logBuf.split('\n').slice(-40).join('\n'));
    setTimeout(() => process.exit(fail === 0 ? 0 : 1), 300);
})();
