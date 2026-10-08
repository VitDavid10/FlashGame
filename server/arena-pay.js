'use strict';
/*
 * Dinero de las ARENAS de pago (server/squad.js lo usa).
 *
 *  - Precio: el grupo elige de 0 a 20 $. El precio en $PILLY de cada "bracket" (modo + tamano + dolares) se FIJA en
 *    cuanto alguien entra en el y se queda asi mientras haya alguien dentro; al vaciarse, el siguiente que entre lo fija
 *    otra vez con el precio vivo del token. Asi los dos grupos que se enfrentan pagan exactamente lo mismo.
 *  - Cobro: al dar LISTO cada jugador firma la entrada (la misma firma que las salas normales, ver authorizeEntry) y se
 *    le resta del saldo del juego. Esa entrada queda RETENIDA (hold) hasta que la partida acaba o se devuelve.
 *  - Lo retenido se guarda en disco: si el servidor se reinicia con dinero retenido, al arrancar se devuelve todo.
 *  - Reparto: el equipo ganador se lleva el bote a partes iguales. Por cada jugador que se comio un BOT (y no otro
 *    jugador) la casa se queda el 10 % de su entrada. Empate: cada uno recupera lo suyo.
 *  - Premios: quedan como "claims" y se cobran con una firma (CLAIM en la pantalla de victoria o en el PROFILE).
 *    No caducan ni se abonan solos: se quedan guardados hasta que el jugador los cobra.
 */
const fs = require('fs');

const BOT_FEE = 0.10;

function createArenaPay(o) {
    const file = o.file || null;
    const credit = o.credit;            // (wallet, pill) -> abona al saldo del juego
    const treasury = o.treasury || (() => {});   // (pill, motivo)
    const verify = o.verify || (() => false);    // (wallet, message, signature[]) -> bool
    const log = o.log || (() => {});
    const now = o.now || (() => Date.now());

    let db = { holds: {}, claims: {}, hist: [] };   // hist: premios ganados (cobrados o no), para el historial del PROFILE
    if (file) { try { db = Object.assign(db, JSON.parse(fs.readFileSync(file, 'utf8')) || {}); } catch (e) {} }
    if (!Array.isArray(db.hist)) db.hist = [];
    const marcaCobrado = id => { const h = db.hist.find(x => x.id === id); if (h) h.claimed = now(); };
    let dirty = false;
    const save = () => { if (!file || !dirty) return; dirty = false; try { fs.writeFileSync(file + '.tmp', JSON.stringify(db)); fs.renameSync(file + '.tmp', file); } catch (e) { dirty = true; log('[arena] no se pudo guardar ' + file + ': ' + e.message); } };
    // Libro de cuentas: cada premio y cada cobro (con su firma) se apunta al momento, una linea por suceso, y nunca se borra.
    // Si arena-pay.json falta o va por detras, al arrancar se reconstruye de aqui: un premio apuntado no se pierde.
    const ledgerFile = file ? file.replace(/\.json$/, '') + '-ledger.jsonl' : null;
    const led = ev => { if (!ledgerFile) return; try { fs.appendFileSync(ledgerFile, JSON.stringify(ev) + '\n'); } catch (e) { log('[arena] no se pudo apuntar en el libro: ' + e.message); } };
    if (ledgerFile) {
        let n = 0, rec = 0;
        try {
            for (const ln of fs.readFileSync(ledgerFile, 'utf8').split('\n')) {
                if (!ln) continue; let ev; try { ev = JSON.parse(ln); } catch (e) { continue; } n++;
                if (ev.t === 'prize' && !db.hist.some(h => h.id === ev.id)) { db.claims[ev.id] = { wallet: ev.wallet, amount: ev.amount, matchId: ev.matchId || '', at: ev.at }; db.hist.push({ id: ev.id, wallet: ev.wallet, amount: ev.amount, at: ev.at, size: ev.size | 0, cents: ev.cents | 0, claimed: 0 }); rec++; }
                else if (ev.t === 'claim') for (const id of ev.ids || []) { if (db.claims[id]) { delete db.claims[id]; rec++; } const h = db.hist.find(x => x.id === id); if (h && !h.claimed) h.claimed = ev.at; }
            }
        } catch (e) { if (e.code !== 'ENOENT') log('[arena] no se pudo leer el libro: ' + e.message); }
        dirty = rec > 0;
        log('[arena] ' + Object.keys(db.claims).length + ' premios por cobrar y ' + db.hist.length + ' en el historial (libro: ' + n + ' sucesos, ' + rec + ' recuperados)');
    }
    const timer = setInterval(() => { save(); }, 5000); if (timer.unref) timer.unref();
    if (file) for (const sig of ['SIGTERM', 'SIGINT', 'beforeExit']) process.once(sig, () => { try { dirty = true; save(); } catch (e) {} });

    // Al arrancar: lo que quedo retenido de antes del reinicio se devuelve entero.
    const viejos = Object.keys(db.holds);
    if (viejos.length) {
        for (const ref of viejos) { const h = db.holds[ref]; try { credit(h.wallet, h.fee); } catch (e) {} log(`[arena] reinicio: devuelto ${h.fee} PILL a ${h.wallet.slice(0, 6)}…`); }
        db.holds = {}; dirty = true; save();
    }

    let seq = 0;
    const newRef = () => now().toString(36) + '-' + (++seq).toString(36) + '-' + Math.random().toString(36).slice(2, 6);

    // ---------- precio fijado por bracket ----------
    const brackets = new Map();   // key -> { fee, users }
    function feeOf(key, usd, quote) {
        if (!(usd > 0)) return 0;
        let b = brackets.get(key);
        if (!b || b.users <= 0) { b = { fee: Math.max(1, Math.round(quote(usd))), users: 0 }; brackets.set(key, b); }
        return b.fee;
    }
    function useBracket(key, d) { const b = brackets.get(key); if (b) { b.users = Math.max(0, b.users + d); if (!b.users) brackets.delete(key); } }
    const bracketFee = key => (brackets.get(key) || {}).fee || 0;

    // ---------- retenciones ----------
    function hold(wallet, fee, info) {
        const ref = newRef();
        db.holds[ref] = { wallet, fee, at: now(), info: info || '' }; dirty = true;
        return ref;
    }
    function refund(ref, why) {
        const h = db.holds[ref]; if (!h) return 0;
        delete db.holds[ref]; dirty = true;
        try { credit(h.wallet, h.fee); } catch (e) {}
        log(`[arena] devuelto ${h.fee} PILL a ${h.wallet.slice(0, 6)}… (${why || 'cancelado'})`);
        return h.fee;
    }
    // La retencion pasa a ser parte del bote de una partida (ya no se devuelve sola).
    function take(ref) { const h = db.holds[ref]; if (!h) return null; delete db.holds[ref]; dirty = true; return h; }

    // ---------- reparto al acabar ----------
    // players: [{ team, wallet, fee, byBot }] (solo los que pagaron); winner: 'A' | 'B' | null.
    // Devuelve { pot, fee, share, prizes: [{ wallet, amount, id }] }.
    function settle(matchId, players, winner, meta) {
        const pot = players.reduce((n, p) => n + (p.fee | 0), 0);
        if (!pot) return { pot: 0, comision: 0, share: 0, prizes: [] };
        if (!winner) {
            // Empate: cada uno recupera lo suyo (sin comision). Lo de la casa (wallet null) no se mueve.
            for (const p of players) if (p.wallet) try { credit(p.wallet, p.fee); } catch (e) {}
            log(`[arena] ${matchId}: empate, devueltas las entradas (${pot} PILL)`);
            return { pot, comision: 0, share: 0, prizes: [], draw: true };
        }
        let comision = 0;
        for (const p of players) if (p.byBot) comision += Math.floor(p.fee * BOT_FEE);
        const ganadores = players.filter(p => p.team === winner);
        const pool = pot - comision;
        if (!ganadores.length) { treasury(pot, 'arena sin ganadores que pagaran'); return { pot, comision: pot, share: 0, prizes: [] }; }
        const share = Math.floor(pool / ganadores.length);
        const resto = pool - share * ganadores.length;
        if (comision + resto > 0) treasury(comision + resto, 'arena: comision por bot');
        // La parte de un ganador sin wallet (bot de prueba, entrada de la casa) vuelve a la casa.
        const casa = ganadores.filter(p => !p.wallet).length * share;
        if (casa > 0) treasury(casa, 'arena: parte de los bots de prueba');
        const prizes = ganadores.filter(p => p.wallet).map(p => ({ wallet: p.wallet, amount: share, id: addClaim(p.wallet, share, matchId, meta) }));
        log(`[arena] ${matchId}: bote ${pot} PILL, comision ${comision + resto}, ${ganadores.length} ganadores a ${share} cada uno`);
        return { pot, comision: comision + resto, share, prizes };
    }

    // ---------- premios por cobrar ----------
    function addClaim(wallet, amount, matchId, meta) {
        const id = newRef();
        db.claims[id] = { wallet, amount, matchId: matchId || '', at: now() }; dirty = true;
        db.hist.push({ id, wallet, amount, at: now(), size: (meta && meta.size) | 0, cents: (meta && meta.cents) | 0, claimed: 0 });
        led({ t: 'prize', id, wallet, amount, matchId: matchId || '', at: now(), size: (meta && meta.size) | 0, cents: (meta && meta.cents) | 0 }); save();
        if (db.hist.length > 5000) db.hist.splice(0, db.hist.length - 5000);
        return id;
    }
    // Ultimos premios de una wallet (los mas nuevos primero).
    const historyOf = (wallet, n = 30) => db.hist.filter(h => h.wallet === wallet).slice(-n).reverse();
    const claimMessage = id => `PillWars claim arena ${id}`;
    function claim(id, wallet, message, signature) {
        const c = db.claims[id];
        if (!c) return { ok: false, reason: 'already_claimed' };
        if (c.wallet !== wallet || message !== claimMessage(id)) return { ok: false, reason: 'bad_claim' };
        if (!verify(wallet, message, signature)) return { ok: false, reason: 'bad_signature' };
        delete db.claims[id]; marcaCobrado(id); dirty = true;
        led({ t: 'claim', ids: [id], wallet, amount: c.amount, at: now(), message, signature }); save();
        try { credit(wallet, c.amount); } catch (e) {}
        log(`[arena] premio cobrado: ${c.amount} PILL a ${wallet.slice(0, 6)}…`);
        return { ok: true, amount: c.amount };
    }
    // Cobrar TODO lo pendiente de una wallet con una sola firma (PROFILE / REWARDS).
    const claimAllMessage = ts => `PillWars claim arena prizes @ ${ts}`;
    function claimAll(wallet, message, signature, ts) {
        ts = Number(ts) || 0;
        if (message !== claimAllMessage(ts) || Math.abs(now() - ts) > 120000) return { ok: false, reason: 'bad_claim' };
        const ids = Object.keys(db.claims).filter(id => db.claims[id].wallet === wallet);
        if (!ids.length) return { ok: false, reason: 'already_claimed' };
        if (!verify(wallet, message, signature)) return { ok: false, reason: 'bad_signature' };
        let amount = 0;
        for (const id of ids) { amount += db.claims[id].amount; delete db.claims[id]; marcaCobrado(id); }
        dirty = true; led({ t: 'claim', ids, wallet, amount, at: now(), message, signature }); save();
        try { credit(wallet, amount); } catch (e) {}
        log(`[arena] premios cobrados de golpe: ${amount} PILL (${ids.length}) a ${wallet.slice(0, 6)}…`);
        return { ok: true, amount, n: ids.length };
    }
    const claimsOf = wallet => Object.entries(db.claims).filter(([, c]) => c.wallet === wallet).map(([id, c]) => ({ id, amount: c.amount, at: c.at }));

    return { feeOf, useBracket, bracketFee, hold, refund, take, settle, claim, claimMessage, claimAll, claimAllMessage, claimsOf, historyOf, flush: () => { dirty = true; save(); }, _db: () => db, BOT_FEE };
}

module.exports = { createArenaPay, BOT_FEE };
