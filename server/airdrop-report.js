'use strict';
/*
 * Airdrop participants and their points, straight from the data file, with the
 * same scoring the page uses (server/airdrop-score.js). Read-only: it never
 * writes the file, so it is safe to run while the server is up.
 *
 *   node server/airdrop-report.js            top 50 by points
 *   node server/airdrop-report.js all        everyone
 *   node server/airdrop-report.js @handle    one participant (X handle or wallet start)
 */
const path = require('path');
const { createStore } = require('./airdrop-store.js');
const { createScore, xPts, walletPts, invitePts } = require('./airdrop-score.js');

const file = process.env.AIRDROP_DATA_FILE || path.join(__dirname, 'airdrop-data.json');
const store = createStore({ file });
const score = createScore({ inviteCountOf: store.inviteCount });
const arg = process.argv[2] || '';

const short = w => (w ? w.slice(0, 4) + '...' + w.slice(-4) : '-');
const n = v => Math.round(v || 0).toLocaleString('en-US');

const rows = Object.values(store._data().users).map(u => {
    // Work on a copy: view() fills in today's daily state and must not touch the real record.
    const c = JSON.parse(JSON.stringify(u));
    const v = score.view(c);
    const invites = store.inviteCount(u);
    return {
        u, x: u.x ? '@' + u.x.username : '-', wallet: u.wallet || '', invites,
        xp: xPts(u.x), onchain: walletPts(u.wallet, store.chainOf(u)), inv: invitePts(invites),
        quests: v.socialPts, arena: v.gamePts, boosted: v.boosted, total: v.total,
        checked: !!store.chainOf(u),
    };
}).sort((a, b) => b.total - a.total);

let list = rows;
if (arg && arg !== 'all') {
    const q = arg.replace(/^@/, '').toLowerCase();
    list = rows.filter(r => r.x.toLowerCase() === '@' + q || r.wallet.toLowerCase().startsWith(q));
} else if (!arg) list = rows.slice(0, 50);

const linked = rows.filter(r => r.u.wallet || r.u.x);
console.log(`Participants: ${rows.length} | with X: ${rows.filter(r => r.u.x).length} | with wallet: ${rows.filter(r => r.u.wallet).length} | points in total: ${n(linked.reduce((a, r) => a + r.total, 0))}`);
console.log('');
const head = ['#', 'X', 'WALLET', 'X PTS', 'ON-CHAIN', 'INVITES', 'QUESTS', 'ARENA', 'BOOST', 'TOTAL'];
const table = list.map(r => [
    String(rows.indexOf(r) + 1), r.x, short(r.wallet), n(r.xp),
    r.wallet.startsWith('Demo') ? 'demo' : r.wallet && !r.checked ? 'checking' : n(r.onchain),
    `${r.invites} (${n(r.inv)})`, n(r.quests), n(r.arena), r.boosted ? 'x1.5' : '-', n(r.total),
]);
const widths = head.map((h, i) => Math.max(h.length, ...table.map(t => t[i].length)));
const line = cells => cells.map((c, i) => (i === 0 || i >= 3 ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ');
console.log(line(head));
table.forEach(t => console.log(line(t)));
if (!list.length) console.log('(nobody matches)');
