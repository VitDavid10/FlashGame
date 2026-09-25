'use strict';
/*
 * The airdrop's private dashboard: who is registered, their points and what
 * share of the pool that is.
 *
 * There is no password and no login form, and the page is not linked from
 * anywhere. The ONLY way in is to open a link minted from a shell ON the
 * server:
 *
 *   curl -s -X POST http://127.0.0.1:<port>/api/airdrop/admin-link
 *
 * That request is only accepted when it really comes from the machine itself:
 * the socket is loopback AND there is no x-forwarded-for header, which Caddy
 * always adds to anything coming from the internet. The link it prints works
 * for ADMIN_TTL_MS and then dies; minting a new one kills the previous.
 *
 * DISCARD: each row has a button to manually flag a wallet as not eligible
 * (suspected sybil/bot) regardless of its points. It moves to its own tab and
 * out of the split; RESTORE brings it back any time. This is a judgement call
 * an admin makes, not automatic - nothing here bans or deletes the account.
 */
const crypto = require('crypto');

const ADMIN_TTL_MS = 30 * 60 * 1000;
const SUPPLY = 1e9, AIRDROP_PCT = 10;
// A wallet just old/used enough to count as a real invite (see INVITE_MIN_AGE_DAYS/
// INVITE_MIN_TXS in airdrop-store.js) already scores about this much from age+tx
// tiers alone. Below it, a signup is most likely a driveby: connected X and did
// nothing else. Adjust freely - it only changes who this dashboard treats as paid.
const MIN_ELIGIBLE_POINTS = 500;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n || 0).toLocaleString('en-US');
const short = w => (w ? w.slice(0, 4) + '...' + w.slice(-4) : '-');
const explorerUrl = w => 'https://solscan.io/account/' + encodeURIComponent(w);

/** Loopback socket and no proxy header: the request was made on the server. */
function fromServerItself(req) {
    if (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.headers['forwarded']) return false;
    const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    return ip === '127.0.0.1' || ip === '::1';
}

function createAdmin(opts) {
    const store = opts.store, score = opts.score, log = opts.log || (() => {});
    const now = opts.now || Date.now;
    const origin = process.env.AIRDROP_ORIGIN || 'https://pillwars.fun';
    let current = null;   // { token, until }

    function mint() {
        current = { token: crypto.randomBytes(24).toString('base64url'), until: now() + ADMIN_TTL_MS };
        log('[airdrop] admin link minted, valid for ' + Math.round(ADMIN_TTL_MS / 60000) + ' minutes');
        return origin + '/airdrop-admin/' + current.token;
    }
    function valid(token) {
        if (!current || now() > current.until) return false;
        const a = Buffer.from(String(token)), b = Buffer.from(current.token);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    /** Toggle a discard flag; only callable with a currently valid admin token. */
    function setDiscarded(token, uid, on) {
        if (!valid(token) || !uid) return false;
        const ok = store.setDiscarded(uid, on);
        if (ok) log('[airdrop] admin ' + (on ? 'discarded' : 'restored') + ' ' + uid);
        return ok;
    }
    /** Wipe a participant for good; only one already DISCARDED, and only with a valid admin token. */
    function removeUser(token, uid) {
        if (!valid(token) || !uid) return false;
        const u = store._data().users[uid];
        if (!u || !u.discarded) return false;
        const who = (u.x ? '@' + u.x.username : '') + (u.wallet ? ' ' + u.wallet : '');
        const ok = store.removeUser(uid);
        if (ok) log('[airdrop] admin deleted ' + uid + ' (' + who.trim() + ')');
        return ok;
    }

    /** Everyone registered, with the same scoring the page uses. */
    function rows() {
        const users = Object.values(store._data().users);
        const list = users.map(u => {
            // A copy: view() fills in today's daily state and must not touch the record.
            const v = score.view(JSON.parse(JSON.stringify(u)));
            return {
                uid: u.uid, discarded: !!u.discarded, x: u.x ? '@' + u.x.username : '', wallet: u.wallet || '', invites: store.inviteCount(u),
                quests: v.socialPts, arena: v.gamePts, verified: v.verified, boosted: v.boosted,
                total: v.total, checked: !!store.chainOf(u),
            };
        }).sort((a, b) => b.total - a.total);
        const active = list.filter(r => !r.discarded);
        const discarded = list.filter(r => r.discarded);
        // Who actually gets paid: a linked wallet, not discarded, AND at least
        // MIN_ELIGIBLE_POINTS - filters out a bare "connected X and did nothing
        // else" driveby signup.
        const eligible = active.filter(r => r.wallet && r.total >= MIN_ELIGIBLE_POINTS);
        const pool = SUPPLY * AIRDROP_PCT / 100;
        const sum = eligible.reduce((a, r) => a + r.total, 0) || 1;
        eligible.forEach((r, i) => { r.rank = i + 1; r.pct = r.total / sum * 100; r.tokens = pool * r.total / sum; });
        return { active, eligible, discarded, pool, sum };
    }

    const head = '<tr><th>#</th><th>X</th><th>WALLET</th><th class=n>ON-CHAIN+X+INV</th><th class=n>QUESTS</th><th class=n>ARENA</th><th class=n>BOOST</th><th class=n>TOTAL</th><th class=n>SHARE</th><th class=n>$PILLY</th><th></th></tr>';
    function walletCell(r, why) {
        if (!r.wallet) return '<i>no wallet</i>';
        const a = '<a href="' + esc(explorerUrl(r.wallet)) + '" target="_blank" rel="noopener noreferrer" title="' + esc(r.wallet) + (why ? ' (' + why + ')' : '') + '">' + esc(short(r.wallet)) + '</a>';
        return why ? a + ' <i>(' + why + ')</i>' : a;
    }
    function row(r, opts2) {
        const discardTab = opts2 && opts2.discardTab;
        const paid = !discardTab && r.wallet && r.total >= MIN_ELIGIBLE_POINTS;
        const why = discardTab ? '' : !r.wallet ? 'no wallet' : r.total < MIN_ELIGIBLE_POINTS ? '&lt; ' + fmt(MIN_ELIGIBLE_POINTS) + ' pts' : '';
        const action = '<button class="act" data-uid="' + esc(r.uid) + '" data-on="' + (discardTab ? '0' : '1') + '">' + (discardTab ? 'RESTORE' : 'DISCARD') + '</button>' +
            (discardTab ? ' <button class="act del" data-uid="' + esc(r.uid) + '">DELETE</button>' : '');
        return '<tr' + (paid ? '' : ' class="unlinked"') + '><td>' + (paid ? r.rank : '-') + '</td><td>' + esc(r.x || '-') + '</td><td>' + walletCell(r, why) + '</td><td class=n>' +
            (r.checked ? fmt(r.verified) : r.wallet ? '<i>checking</i>' : '-') + '</td><td class=n>' + fmt(r.quests) + '</td><td class=n>' + fmt(r.arena) + '</td><td class=n>' + (r.boosted ? 'x1.5' : '-') +
            '</td><td class=n><b>' + fmt(r.total) + '</b></td><td class=n>' + (paid ? r.pct.toFixed(2) + '%' : '-') + '</td><td class=n>' + (paid ? fmt(r.tokens) : '-') + '</td><td>' + action + '</td></tr>';
    }

    function page() {
        const { active, eligible, discarded, pool, sum } = rows();
        const eligibleBody = eligible.map(r => row(r)).join('');
        const allBody = active.map(r => row(r)).join('');
        const discardedBody = discarded.map(r => row(r, { discardTab: true })).join('');
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Airdrop admin</title>
<meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;padding:24px;background:#050505;color:#e8f5ee;font:15px/1.5 ui-monospace,Menlo,Consolas,monospace}
h1{font-size:20px;margin:0 0 4px;color:#ccff00} .sub{color:#8fa89a;margin:0 0 20px}
.cards{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}
.card{background:#07140e;box-shadow:0 0 0 2px #0f3a25;padding:12px 16px;min-width:150px}
.card b{display:block;font-size:22px;color:#00ff88} .card span{color:#8fa89a;font-size:13px;text-transform:uppercase}
.tabs{display:flex;gap:8px;margin-bottom:10px}
.tabs button{font:inherit;background:#07140e;color:#8fa89a;box-shadow:0 0 0 2px #0f3a25;border:0;padding:8px 16px;cursor:pointer}
.tabs button.on{color:#00ff88;box-shadow:0 0 0 2px #00ff88}
table{border-collapse:collapse;width:100%;background:#07140e;box-shadow:0 0 0 2px #0f3a25}
th,td{padding:7px 10px;border-bottom:1px solid #0f3a25;text-align:left;white-space:nowrap}
th{color:#8fa89a;font-weight:400;font-size:12px;text-transform:uppercase}
td.n,th.n{text-align:right} tbody tr:hover{background:#0a1f14} i{color:#8fa89a}
tr.unlinked{opacity:.6}
a{color:#00ff88} a:hover{color:#fff}
.act{font:inherit;font-size:12px;background:none;color:#8fa89a;box-shadow:0 0 0 1px #0f3a25;border:0;padding:4px 8px;cursor:pointer}
.act:hover{color:#fff;box-shadow:0 0 0 1px #8fa89a}
.act.del{color:#f62a2d;box-shadow:0 0 0 1px #5a1414} .act.del:hover{color:#fff;box-shadow:0 0 0 1px #f62a2d}
.note{color:#8fa89a;margin:18px 0 0;font-size:13px}
[hidden]{display:none}
</style></head><body>
<h1>PILLWARS AIRDROP - ADMIN</h1>
<p class="sub">${new Date(now()).toISOString().replace('T', ' ').slice(0, 16)} UTC. This link dies ${Math.max(0, Math.round((current.until - now()) / 60000))} minutes from now.</p>
<div class="cards">
  <div class="card"><b>${fmt(active.length)}</b><span>Registered</span></div>
  <div class="card"><b>${fmt(eligible.length)}</b><span>Eligible (wallet, ${fmt(MIN_ELIGIBLE_POINTS)}+ pts)</span></div>
  <div class="card"><b>${fmt(active.filter(r => r.x).length)}</b><span>With X</span></div>
  <div class="card"><b>${fmt(sum)}</b><span>Points, eligible only</span></div>
  <div class="card"><b>${fmt(pool)}</b><span>$PILLY pool (${AIRDROP_PCT}%)</span></div>
</div>
<div class="tabs">
  <button class="on" data-t="eligible">ELIGIBLE (${fmt(eligible.length)})</button>
  <button data-t="all">ALL (${fmt(active.length)})</button>
  <button data-t="discarded">DISCARDED (${fmt(discarded.length)})</button>
</div>
<table id="tab-eligible"><thead>${head}</thead><tbody>${eligibleBody || '<tr><td colspan="11"><i>nobody eligible yet</i></td></tr>'}</tbody></table>
<table id="tab-all" hidden><thead>${head}</thead><tbody>${allBody || '<tr><td colspan="11"><i>nobody yet</i></td></tr>'}</tbody></table>
<table id="tab-discarded" hidden><thead>${head}</thead><tbody>${discardedBody || '<tr><td colspan="11"><i>nobody discarded</i></td></tr>'}</tbody></table>
<p class="note">Eligible = a linked wallet with at least ${fmt(MIN_ELIGIBLE_POINTS)} points; rank/share/$PILLY are only computed among those (dimmed rows in ALL don't count). Click a wallet to open it on Solscan.</p>
<p class="note">DISCARD is a manual call, not automatic - it just takes a wallet out of the split until you RESTORE it. DELETE (only in DISCARDED) wipes the participant for good, so their X and wallet can sign up again from zero. Points and shares are what the page shows today; the real split is the one taken at the Season 0 snapshot.</p>
<script>
document.querySelectorAll('.tabs button').forEach(function(b){b.onclick=function(){
  document.querySelectorAll('.tabs button').forEach(function(k){k.classList.toggle('on',k===b)});
  ['eligible','all','discarded'].forEach(function(t){document.getElementById('tab-'+t).hidden = b.dataset.t !== t;});
};});
document.querySelectorAll('.act.del').forEach(function(b){b.onclick=function(){
  if (!confirm('Delete this participant for good? Points, invites and links are wiped and their X and wallet can sign up again from zero. This cannot be undone.')) return;
  b.disabled = true;
  fetch(location.pathname + '/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: b.dataset.uid }) })
    .then(function(r){ if (r.ok) location.reload(); else { b.disabled = false; alert('Could not delete - the link may have expired.'); } });
};});
document.querySelectorAll('.act:not(.del)').forEach(function(b){b.onclick=function(){
  b.disabled = true;
  fetch(location.pathname + '/discard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: b.dataset.uid, on: b.dataset.on === '1' }) })
    .then(function(r){ if (r.ok) location.reload(); else { b.disabled = false; alert('Could not save - the link may have expired.'); } });
};});
</script>
</body></html>`;
    }

    return { fromServerItself, mint, valid, setDiscarded, removeUser, page, ADMIN_TTL_MS };
}

module.exports = { createAdmin, fromServerItself, ADMIN_TTL_MS };
