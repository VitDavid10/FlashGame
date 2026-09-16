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
 */
const crypto = require('crypto');

const ADMIN_TTL_MS = 30 * 60 * 1000;
const SUPPLY = 1e9, AIRDROP_PCT = 10;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n || 0).toLocaleString('en-US');
const short = w => (w ? w.slice(0, 4) + '...' + w.slice(-4) : '-');

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

    /** Everyone registered, with the same scoring the page uses. */
    function rows() {
        const users = Object.values(store._data().users);
        const list = users.map(u => {
            // A copy: view() fills in today's daily state and must not touch the record.
            const v = score.view(JSON.parse(JSON.stringify(u)));
            return {
                x: u.x ? '@' + u.x.username : '', wallet: u.wallet || '', invites: store.inviteCount(u),
                quests: v.socialPts, arena: v.gamePts, verified: v.verified, boosted: v.boosted,
                total: v.total, checked: !!store.chainOf(u),
            };
        }).sort((a, b) => b.total - a.total);
        // Only a linked wallet can be paid: that is what makes someone eligible.
        const eligible = list.filter(r => r.wallet);
        const pool = SUPPLY * AIRDROP_PCT / 100;
        const sum = eligible.reduce((a, r) => a + r.total, 0) || 1;
        eligible.forEach((r, i) => { r.rank = i + 1; r.pct = r.total / sum * 100; r.tokens = pool * r.total / sum; });
        return { list, eligible, pool, sum };
    }

    function page() {
        const { list, eligible, pool, sum } = rows();
        // Everyone registered, not just the eligible ones - the whole point is to
        // actually see who signed up. Rank/share/$PILLY only mean anything for a
        // linked wallet, so those columns are blank for an X-only row.
        const head = '<tr><th>#</th><th>X</th><th>WALLET</th><th class=n>ON-CHAIN+X+INV</th><th class=n>QUESTS</th><th class=n>ARENA</th><th class=n>BOOST</th><th class=n>TOTAL</th><th class=n>SHARE</th><th class=n>$PILLY</th></tr>';
        const body = list.map((r, i) => '<tr' + (r.wallet ? '' : ' class="unlinked"') + '><td>' + (r.wallet ? r.rank : '-') + '</td><td>' + esc(r.x || '-') + '</td><td title="' + esc(r.wallet) + '">' + (r.wallet ? esc(short(r.wallet)) : '<i>no wallet</i>') + '</td><td class=n>' +
            (r.checked ? fmt(r.verified) : r.wallet ? '<i>checking</i>' : '-') + '</td><td class=n>' + fmt(r.quests) + '</td><td class=n>' + fmt(r.arena) + '</td><td class=n>' + (r.boosted ? 'x1.5' : '-') +
            '</td><td class=n><b>' + fmt(r.total) + '</b></td><td class=n>' + (r.wallet ? r.pct.toFixed(2) + '%' : '-') + '</td><td class=n>' + (r.wallet ? fmt(r.tokens) : '-') + '</td></tr>').join('');
        return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Airdrop admin</title>
<meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;padding:24px;background:#050505;color:#e8f5ee;font:15px/1.5 ui-monospace,Menlo,Consolas,monospace}
h1{font-size:20px;margin:0 0 4px;color:#ccff00} .sub{color:#8fa89a;margin:0 0 20px}
.cards{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}
.card{background:#07140e;box-shadow:0 0 0 2px #0f3a25;padding:12px 16px;min-width:150px}
.card b{display:block;font-size:22px;color:#00ff88} .card span{color:#8fa89a;font-size:13px;text-transform:uppercase}
table{border-collapse:collapse;width:100%;background:#07140e;box-shadow:0 0 0 2px #0f3a25}
th,td{padding:7px 10px;border-bottom:1px solid #0f3a25;text-align:left;white-space:nowrap}
th{color:#8fa89a;font-weight:400;font-size:12px;text-transform:uppercase}
td.n,th.n{text-align:right} tbody tr:hover{background:#0a1f14} i{color:#8fa89a}
tr.unlinked{opacity:.6}
.note{color:#8fa89a;margin:18px 0 0;font-size:13px}
</style></head><body>
<h1>PILLWARS AIRDROP - ADMIN</h1>
<p class="sub">${new Date(now()).toISOString().replace('T', ' ').slice(0, 16)} UTC. This link dies ${Math.max(0, Math.round((current.until - now()) / 60000))} minutes from now.</p>
<div class="cards">
  <div class="card"><b>${fmt(list.length)}</b><span>Registered</span></div>
  <div class="card"><b>${fmt(eligible.length)}</b><span>Eligible (wallet)</span></div>
  <div class="card"><b>${fmt(list.filter(r => r.x).length)}</b><span>With X</span></div>
  <div class="card"><b>${fmt(sum)}</b><span>Points in total</span></div>
  <div class="card"><b>${fmt(pool)}</b><span>$PILLY pool (${AIRDROP_PCT}%)</span></div>
</div>
<table><thead>${head}</thead><tbody>${body || '<tr><td colspan="10"><i>nobody yet</i></td></tr>'}</tbody></table>
<p class="note">Only a linked wallet can be paid, so rank/share/$PILLY are blank for the dimmed rows (X only, no wallet yet).</p>
<p class="note">Points and shares are what the page shows today; the real split is the one taken at the Season 0 snapshot.</p>
</body></html>`;
    }

    return { fromServerItself, mint, valid, page, ADMIN_TTL_MS };
}

module.exports = { createAdmin, fromServerItself, ADMIN_TTL_MS };
