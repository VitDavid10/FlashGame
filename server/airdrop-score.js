'use strict';
/*
 * Server-authoritative points: Daily Arena missions, social quests, and the
 * total they feed into. The client still renders everything (it has all the
 * text/UI), but every NUMBER that matters - gamePts, socialPts, and the total
 * used to decide when "share card" pays again - is computed and stored here,
 * from data the server itself verified (X profile from OAuth, wallet data
 * from mainnet, invite count from the store). A forged request can at most
 * trigger one real, capped mission or quest; it can never set a point value
 * directly, and editing localStorage in devtools has no lasting effect since
 * the client is corrected from here on every sync.
 *
 * These constants must stay in sync with the same ones in airdrop.html and
 * with docs/airdrop-points.md - all three describe the same rules.
 *
 * Anti-cheat this adds over the old client-only version:
 *  - "survive N seconds" and match duration are measured by the SERVER'S
 *    clock (Date.now() - match.startedAt), never trusted from the client.
 *  - Kills/splits/virus pops are deduplicated server-side with the same
 *    cooldown windows the client used to apply to itself - a flood of forged
 *    events can't inflate them.
 *  - Every mission/task/post pays out at most once, tracked here - not in
 *    localStorage.
 *  - The reactivation threshold for "share card" (+10% growth) is checked
 *    against a total computed here from verified data, not a number the
 *    client can influence.
 */
const AIRDROPS_TOTAL = 11;   // 10 verified airdrops + Jumper (see airdrop-tokens.js / airdrop-jumper.js)
const HUNTER_MAX = 11000, HUNTER_TIERS = [[1, .2], [2, .35], [3, .5], [4, .65], [5, .8], [6, .9], [7, 1]];
const TX_MAX = 2400, TX_TIERS = [[50, .1], [200, .25], [500, .4], [1000, .6], [2500, .8], [5000, 1]];
const AGE_MAX = 2400, AGE_TIERS = [[30, .1], [90, .25], [180, .4], [365, .6], [730, .8], [1095, 1]];
const GENESIS_PTS = 7000, MADLADS_PTS = 7000;
const INVITE_MILES = [[1, 250], [3, 350], [5, 500], [10, 700], [15, 700], [20, 700], [25, 700], [30, 700], [35, 700], [40, 700], [45, 700], [50, 1300]];
const tierPct = (v, tiers) => tiers.reduce((p, t) => v >= t[0] ? t[1] : p, 0);

const MIN_KILL_GAP_MS = 350;      // anti-flood; the split-kill bonus below uses its own 1500ms window
const SPLIT_KILL_MS = 1500;
const SPLIT_GAP_MS = 300, VIRUS_GAP_MS = 500, SKILL_GAP_MS = 250, PICK_GAP_MS = 3000;
const MIN_MATCH_MS = 5000;        // a match must last this long (or land a kill) to count for "play N matches"
const MAX_MATCH_AGE_MS = 10 * 60 * 1000;   // abandoned matches (no /end) expire instead of blocking the next one
const MAX_KILLS_PER_MATCH = 60;
const MAX_MASS = 200000;
// Just enough to stop a tight synchronous loop; MIN_MATCH_MS (or a kill) is
// the real defense against farming "play N matches" without really playing.
const MIN_BEGIN_GAP_MS = 500;

function rng(seed) {
    let h = 2166136261;
    for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

// Same five tiers, same daily point values as the client's QUEST_POOLS.
const QUEST_POOLS = [
    { tier: 'EASY', pts: 20, quests: [
        { id: 'e-kill1', goal: 1, today: d => d.kills },
        { id: 'e-pieces5', goal: 5, today: d => d.c.pieces },
        { id: 'e-skills2', goal: 2, today: d => d.c.skills },
        { id: 'e-mass3k', goal: 3000, match: m => m.maxMass },
        { id: 'e-survive60', goal: 60, match: m => m.aliveS },
    ] },
    { tier: 'MEDIUM', pts: 60, quests: [
        { id: 'm-kill3', goal: 3, today: d => d.kills },
        { id: 'm-splitkill', goal: 1, today: d => d.c.splitKills },
        { id: 'm-pieces15', goal: 15, today: d => d.c.pieces },
        { id: 'm-mass8k', goal: 8000, match: m => m.maxMass },
        { id: 'm-skills3', goal: 3, today: d => d.c.skillSet.length },
    ] },
    { tier: 'HARD', pts: 130, quests: [
        { id: 'h-kill5', goal: 5, today: d => d.kills },
        { id: 'h-kill3match', goal: 3, match: m => m.kills },
        { id: 'h-mass20k', goal: 20000, match: m => m.maxMass },
        { id: 'h-finish', goal: 1, match: m => m.finished ? 1 : 0 },
        { id: 'h-top5', goal: 1, match: m => m.finished && m.place && m.place <= 5 ? 1 : 0 },
    ] },
    { tier: 'SKILL', pts: 45, quests: [
        { id: 's-sprint', goal: 1, today: d => d.c.skill[3] || 0 },
        { id: 's-blink', goal: 1, today: d => d.c.skill[4] || 0 },
        { id: 's-magnet', goal: 1, today: d => d.c.skill[5] || 0 },
        { id: 's-shield', goal: 1, today: d => d.c.skill[6] || 0 },
        { id: 's-shot', goal: 1, today: d => d.c.skill[2] || 0 },
        { id: 's-gamble', goal: 1, today: d => d.c.gambleWins },
    ] },
    { tier: 'GRIND', pts: 45, quests: [
        { id: 'g-play3', goal: 3, today: d => d.matches },
        { id: 'g-survive90', goal: 90, match: m => m.aliveS },
        { id: 'g-split10', goal: 10, today: d => d.c.splits },
        { id: 'g-picks5', goal: 5, today: d => d.c.picks },
        { id: 'g-virus', goal: 1, today: d => d.c.virusPops },
    ] },
];
function missionsFor(day) {
    const r = rng('quests:' + day);
    return QUEST_POOLS.map(p => {
        const q = p.quests[Math.floor(r() * p.quests.length)];
        return Object.assign({ pts: p.pts, tier: p.tier }, q);
    });
}

const TASK_IDS = ['follow', 'tg', 'play', 'discord'];
const DAILY_POST_PTS = 100, POINTS_BOOST = 1.5, REPOST_PTS = 150, LIKE_PTS = 50;
const SHARE_CARD_PTS = 400, SHARE_AGAIN_GROWTH = 1.10;
const RUN_SHARE_PTS = 30;

function newCounters() { return { pieces: 0, skills: 0, skillSet: [], skill: {}, splitKills: 0, splits: 0, picks: 0, virusPops: 0, gambleWins: 0 }; }
function newDaily(date) { return { date, done: {}, best: {}, matches: 0, kills: 0, social: {}, c: newCounters() }; }

/** X account points, mirroring the client's xProfile(). */
function xPts(x) {
    if (!x) return 0;
    const years = x.created_at ? Math.max(0, (Date.now() - Date.parse(x.created_at)) / 31557600000) : 0;
    return Math.min(2500, Math.sqrt(x.followers || 0) * 14) + Math.min(1200, years * 100) + (x.verified ? 300 : 0);
}
/** On-chain points, mirroring the client's walletProfile(). `chain` is the
 * stored { txs, firstAt, nfts, airdrops } (null if not checked yet). */
function walletPts(wallet, chain) {
    if (!wallet) return 0;
    if (!chain) return 0;
    const days = chain.firstAt ? Math.max(0, Math.floor((Date.now() / 1000 - chain.firstAt) / 86400)) : 0;
    // The store keeps nfts as { id: mint } (airdrop-store.js setChain); publicView
    // turns it into a list of ids. Accept both.
    const nfts = Array.isArray(chain.nfts) ? chain.nfts : Object.keys(chain.nfts || {});
    const airdrops = Array.isArray(chain.airdrops) ? chain.airdrops : [];
    const genesis = nfts.includes('saga') || nfts.includes('seeker'), madlads = nfts.includes('madlads');
    return Math.round(HUNTER_MAX * tierPct(airdrops.length, HUNTER_TIERS)) +
        (genesis ? GENESIS_PTS : 0) + (madlads ? MADLADS_PTS : 0) +
        Math.round(AGE_MAX * tierPct(days, AGE_TIERS)) + Math.round(TX_MAX * tierPct(chain.txs || 0, TX_TIERS));
}
const invitePts = n => INVITE_MILES.reduce((a, m) => a + (n >= m[0] ? m[1] : 0), 0);

function createScore(opts) {
    const now = opts.now || Date.now;
    const today = () => new Date(now()).toISOString().slice(0, 10);
    const validPost = id => (opts.postIds || []).includes(id);
    // Injected: the store's own invite count (already excludes fake/too-new
    // wallets - see airdrop-store.js's INVITE_MIN_AGE_DAYS/INVITE_MIN_TXS).
    const inviteCountOf = opts.inviteCountOf || (() => 0);
    // In-progress matches live only in memory, keyed by uid - never written to
    // the persisted user record, so a restart mid-match just loses that match
    // instead of leaving a corrupt "match still running" state on disk.
    const matches = new Map(), lastBegin = new Map();

    function ensure(u) {
        u.score = u.score || { gamePts: 0, socialPts: 0, shareAt: 0, tasks: {}, daily: newDaily(today()) };
        if (u.score.daily.date !== today()) u.score.daily = newDaily(today());
        return u.score;
    }
    const boosted = s => TASK_IDS.every(id => s.tasks[id]);
    /** Everything but gamePts/socialPts, i.e. what the client can't influence. */
    function verifiedPts(u) { return xPts(u.x) + walletPts(u.wallet, u.chain) + invitePts(inviteCountOf(u)); }
    function rawTotal(u, s) { return verifiedPts(u) + s.socialPts + s.gamePts; }

    /** What the client is allowed to see and render. */
    function view(u) {
        const s = ensure(u), m = matches.get(u.uid);
        const raw = rawTotal(u, s);
        return {
            gamePts: s.gamePts, socialPts: s.socialPts, shareAt: s.shareAt, tasks: s.tasks,
            daily: { date: s.daily.date, done: s.daily.done, matches: s.daily.matches, kills: s.daily.kills, social: s.daily.social, c: s.daily.c },
            missions: missionsFor(s.daily.date),
            boosted: boosted(s), verified: verifiedPts(u), total: raw + (boosted(s) ? Math.round(raw * (POINTS_BOOST - 1)) : 0),
            match: m ? { kills: m.kills, maxMass: m.maxMass, aliveS: Math.floor((now() - m.startedAt) / 1000) } : null,
        };
    }

    function beginMatch(u) {
        // A match abandoned without an /end (tab closed, crash, network drop)
        // must not lock the player out of ever starting another one.
        const stale = matches.get(u.uid);
        if (stale && now() - stale.startedAt > MAX_MATCH_AGE_MS) matches.delete(u.uid);
        else if (matches.has(u.uid)) return { error: 'match_running' };
        const last = lastBegin.get(u.uid);
        if (last && now() - last < MIN_BEGIN_GAP_MS) return { error: 'rate' };
        lastBegin.set(u.uid, now());
        matches.set(u.uid, { startedAt: now(), kills: 0, maxMass: 0, finished: false, place: null, credited: false, lastAt: {} });
        ensure(u).tasks.play = true;
        return { view: view(u) };
    }

    function checkMissions(u) {
        const s = ensure(u), m = matches.get(u.uid);
        const daily = { kills: s.daily.kills, matches: s.daily.matches, c: s.daily.c };
        const mv = m ? { kills: m.kills, maxMass: m.maxMass, finished: m.finished, place: m.place, aliveS: Math.floor((now() - m.startedAt) / 1000) } : null;
        for (const q of missionsFor(s.daily.date)) {
            if (mv && q.match) s.daily.best[q.id] = Math.max(s.daily.best[q.id] || 0, q.match(mv));
            if (s.daily.done[q.id]) continue;
            const v = q.match ? (mv ? q.match(mv) : s.daily.best[q.id] || 0) : q.today(daily);
            if (v < q.goal) continue;
            s.daily.done[q.id] = true;
            s.gamePts += q.pts;
        }
    }

    const GAP_MS = { botKilled: MIN_KILL_GAP_MS, split: SPLIT_GAP_MS, virusPop: VIRUS_GAP_MS, skillPick: PICK_GAP_MS, skillUsed: SKILL_GAP_MS, botPieceEaten: 0, mass: 0 };
    /** One semantic game event (the client translates raw game hooks into
     * these - see airdrop.html trackEvent). */
    function reportEvent(u, ev) {
        const s = ensure(u), m = matches.get(u.uid);
        if (!m) return { error: 'no_match' };
        if (!ev || !(ev.type in GAP_MS)) return { error: 'bad_type' };
        const c = s.daily.c, t = now(), gap = GAP_MS[ev.type];
        if (gap > 0 && m.lastAt[ev.type] && t - m.lastAt[ev.type] < gap) return { view: view(u) };
        m.lastAt[ev.type] = t;

        if (ev.type === 'botKilled') {
            if (m.kills < MAX_KILLS_PER_MATCH) {
                if (m.lastAt.split && t - m.lastAt.split < SPLIT_KILL_MS) c.splitKills++;
                m.kills++; s.daily.kills++;
            }
        } else if (ev.type === 'botPieceEaten') c.pieces++;
        else if (ev.type === 'skillUsed') {
            if (typeof ev.id !== 'number') return { error: 'bad_event' };
            c.skills++; c.skill[ev.id] = (c.skill[ev.id] || 0) + 1;
            if (!c.skillSet.includes(ev.id)) c.skillSet.push(ev.id);
            if (ev.id === 8 && ev.win) c.gambleWins++;
        } else if (ev.type === 'split') c.splits++;
        else if (ev.type === 'virusPop') c.virusPops++;
        else if (ev.type === 'skillPick') c.picks++;
        else if (ev.type === 'mass') m.maxMass = Math.min(MAX_MASS, Math.max(m.maxMass, ev.value | 0));

        checkMissions(u);
        return { view: view(u) };
    }

    /** Match over: `finished`/`place` come from the client (the game's own
     * outcome, not independently checkable without a server-run simulation),
     * everything else - survive time, kills, mass - was already measured. */
    function endMatch(u, body) {
        const s = ensure(u), m = matches.get(u.uid);
        if (!m) return { error: 'no_match' };
        m.finished = !!(body && body.finished);
        m.place = body && Number.isInteger(body.place) && body.place > 0 ? body.place : null;
        if (!m.credited && (now() - m.startedAt >= MIN_MATCH_MS || m.kills > 0)) { s.daily.matches++; m.credited = true; }
        checkMissions(u);
        const out = view(u);
        matches.delete(u.uid);
        return { view: out };
    }

    /** "I did X": follow/tg/play/discord (0pts, unlock the boost), daily post
     * (boosted), share card (reactivates once the verified total grows 10%),
     * share a run (once a day), repost/like of a real post (once per post). */
    function completeTask(u, key) {
        const s = ensure(u);
        if (isDone(u, key)) return { view: view(u) };
        if (key === 'daily:post' && !(u.wallet || u.x)) return { error: 'not_linked' };
        let pts = 0;
        // Flat: the x1.5 boost already applies to the whole total once every
        // one-time task is done (see view()'s `raw * POINTS_BOOST`) - applying
        // it here too would double it.
        if (key === 'daily:post') { pts = DAILY_POST_PTS; s.daily.social[key] = true; }
        else if (key === 'daily:run') { pts = RUN_SHARE_PTS; s.daily.social[key] = true; }
        else if (key === 'share') { pts = SHARE_CARD_PTS; s.tasks.share = true; s.shareAt = rawTotal(u, s) + pts; }
        else if (key.startsWith('rt:') && validPost(key.slice(3))) { pts = REPOST_PTS; s.tasks[key] = true; }
        else if (key.startsWith('like:') && validPost(key.slice(5))) { pts = LIKE_PTS; s.tasks[key] = true; }
        else if (TASK_IDS.includes(key)) { s.tasks[key] = true; }
        else return { error: 'bad_key' };
        s.socialPts += pts;
        return { view: view(u) };
    }
    function isDone(u, key) {
        const s = ensure(u);
        if (key === 'share') return !!s.tasks.share && rawTotal(u, s) < (s.shareAt || 0) * SHARE_AGAIN_GROWTH;
        if (key.startsWith('daily:')) return !!s.daily.social[key];
        return !!s.tasks[key];
    }

    return { view, beginMatch, reportEvent, endMatch, completeTask, isDone };
}

module.exports = {
    createScore, QUEST_POOLS, missionsFor, xPts, walletPts, invitePts,
    MIN_KILL_GAP_MS, SPLIT_KILL_MS, MIN_MATCH_MS, MAX_KILLS_PER_MATCH, MIN_BEGIN_GAP_MS, MAX_MATCH_AGE_MS,
    AIRDROPS_TOTAL, TASK_IDS,
};
