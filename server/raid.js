'use strict';
// Raids en el grupo de Telegram: el admin pega el tweet, el bot lo publica con objetivo de likes y RTs,
// la gente va a X y pulsa "I did it". El avance (likes/RTs) sale de los contadores públicos del tweet
// (api.fxtwitter.com); quién participó es de palabra, no se puede comprobar sin la API de X.
const TWEET_RE = /(?:x|twitter|fixupx|fxtwitter|vxtwitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/i;
const DEFAULTS = { likes: 25, reposts: 10, minutes: 60 };
const MAX = { likes: 10000, reposts: 10000, minutes: 24 * 60 };
const HELP = 'To start a raid (admin only):\n/raid <x.com link> [likes] [reposts] [minutes]\n\nExample: /raid https://x.com/pillwarsdotfun/status/123 50 20 60\n/raidend ends the current raid · /raidtop shows the top raiders.';

function createRaid({ tg, fetchImpl, state, save, group, admin, channel, now = Date.now, log = () => {} }) {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const raid = () => state.raid || (state.raid = { points: {}, active: null });
    const bar = (v, goal) => { const n = Math.max(0, Math.min(10, Math.round(10 * v / goal))); return '▓'.repeat(n) + '░'.repeat(10 - n); };
    const nameOf = u => (u.username ? '@' + u.username : [u.first_name, u.last_name].filter(Boolean).join(' ') || String(u.id));
    // Los avisos van a donde se escribió el comando: el grupo, o el privado del admin si lanzó el raid desde ahí.
    const reply = (text, m) => { const dm = m.chat && m.chat.type === 'private'; return tg('sendMessage', { chat_id: dm ? m.chat.id : group, text, parse_mode: 'HTML', reply_parameters: dm ? undefined : { message_id: m.message_id, allow_sending_without_reply: true }, link_preview_options: { is_disabled: true } }); };

    function render(a, final) {
        const left = Math.max(0, Math.ceil((a.endsAt - now()) / 60e3));
        const goalsMet = a.cur.likes >= a.goals.likes && a.cur.reposts >= a.goals.reposts;
        const raiders = Object.values(a.done), shown = raiders.filter(Boolean);
        let t = (final ? (goalsMet ? '🏆 <b>RAID COMPLETE!</b>' : '🏁 <b>RAID ENDED</b>') : '🚀 <b>RAID!</b>') + '\n\n';
        t += esc(a.url) + '\n\n';
        t += '❤️ Likes  ' + a.cur.likes + '/' + a.goals.likes + '  ' + bar(a.cur.likes, a.goals.likes) + '\n';
        t += '🔁 Reposts  ' + a.cur.reposts + '/' + a.goals.reposts + '  ' + bar(a.cur.reposts, a.goals.reposts) + '\n';
        t += '👥 Raiders  ' + raiders.length + '\n';
        if (final) {
            if (raiders.length) t += '\n💊 ' + raiders.slice(0, 15).map(esc).join(' · ') + (raiders.length > 15 ? ' · +' + (raiders.length - 15) : '') + '\n';
            t += '\nThanks to everyone who raided! 🙌';
        } else {
            t += '⏱ ' + left + ' min left\n\n1️⃣ Open the tweet\n2️⃣ Like, repost and comment\n3️⃣ Tap “I did it”';
        }
        return t;
    }
    const keyboard = a => ({ inline_keyboard: [[{ text: '🐦 Open tweet', url: a.url }], [{ text: '✅ I did it', callback_data: 'raid:done:' + a.id }]] });
    async function edit(a, final) {
        const text = render(a, final);
        if (!final && text === a.lastText) return;
        a.lastText = text;
        await tg('editMessageText', { chat_id: group, message_id: a.msgId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: final ? { inline_keyboard: [] } : keyboard(a) })
            .catch(e => { if (!/not modified/i.test(e.message)) throw e; });
    }
    async function counts(id) {
        const j = await fetchImpl('https://api.fxtwitter.com/status/' + id).then(r => r.json());
        if (!j.tweet) throw new Error('tweet not found');
        return { likes: j.tweet.likes || 0, reposts: j.tweet.retweets || 0 };
    }
    // El resultado va en un mensaje nuevo, abajo del todo (si no, se quedaría arriba, enterrado en el chat), y el del raid se borra.
    async function finish(a) {
        raid().active = null; save();
        try {
            await tg('sendMessage', { chat_id: group, text: render(a, true), parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
            await tg('deleteMessage', { chat_id: group, message_id: a.msgId }).catch(() => {});
        } catch (e) { log('raid: resultado ' + e.message); await edit(a, true); }
    }

    async function start(m, args) {
        const hit = TWEET_RE.exec(args[0] || '');
        if (!hit) return reply(esc(HELP), m);
        if (raid().active) return reply('A raid is already running. Use /raidend to stop it first.', m);
        const num = (v, d, max) => { const n = parseInt(v, 10); return n > 0 ? Math.min(n, max) : d; };
        const a = {
            id: hit[2], url: 'https://x.com/' + hit[1] + '/status/' + hit[2],
            goals: { likes: num(args[1], DEFAULTS.likes, MAX.likes), reposts: num(args[2], DEFAULTS.reposts, MAX.reposts) },
            endsAt: now() + num(args[3], DEFAULTS.minutes, MAX.minutes) * 60e3, done: {}, doneIds: {}, cur: { likes: 0, reposts: 0 }, msgId: 0, lastText: '',
        };
        try { a.cur = await counts(a.id); } catch (e) { return reply('I could not read that tweet (' + esc(e.message) + '). Check the link.', m); }
        const sent = await tg('sendMessage', { chat_id: group, text: render(a, false), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: keyboard(a) });
        a.msgId = sent.message_id; a.lastText = render(a, false);
        raid().active = a; save();
        log('raid: iniciado ' + a.id);
        if (m.chat && m.chat.type === 'private') return reply('Raid started in the group ✅', m);
    }

    async function top(m) {
        const r = raid(), t = now();
        if (t - (r.topAt || 0) < 60e3) return;     // una vez por minuto, que no llene el chat
        r.topAt = t;
        const list = Object.values(r.points).sort((x, y) => y.raids - x.raids).slice(0, 10);
        if (!list.length) return reply('No raids yet. Be the first! 💊', m);
        return reply('🏆 <b>Top raiders</b>\n\n' + list.map((p, i) => (i + 1) + '. ' + esc(p.name) + ' · ' + p.raids + ' raid' + (p.raids === 1 ? '' : 's')).join('\n'), m);
    }

    // true si el mensaje era un comando de raid (y ya está atendido).
    async function onCommand(m) {
        const mm = /^\/(raid|raidend|raidtop)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec((m.text || '').trim());
        if (!mm) return false;
        const cmd = mm[1].toLowerCase(), args = (mm[2] || '').trim().split(/\s+/).filter(Boolean);
        if (cmd === 'raidtop') { await top(m); return true; }
        // Solo el admin: con su cuenta o como admin anónimo (escribe "como el grupo" o como el canal; solo los admins pueden). Al resto no se les contesta.
        const isAdmin = (m.from && m.from.id === admin) || (m.sender_chat && (m.sender_chat.id === group || m.sender_chat.id === channel));
        if (!isAdmin) return true;
        if (cmd === 'raid') await start(m, args);
        else if (raid().active) await finish(raid().active);
        else await reply('There is no raid running.', m);
        return true;
    }

    async function onCallback(q) {
        const hit = /^raid:done:(\d+)$/.exec(q.data || '');
        if (!hit) return;
        const a = raid().active, answer = text => tg('answerCallbackQuery', { callback_query_id: q.id, text, show_alert: false }).catch(() => {});
        if (!a || a.id !== hit[1] || now() > a.endsAt) return answer('This raid is over 🏁');
        if (a.doneIds[q.from.id]) return answer("You're already counted ✅");
        a.doneIds[q.from.id] = 1;
        // El admin cuenta como raider pero su usuario no se enseña nunca (ni en el mensaje ni en el ranking).
        if (q.from.id === admin) { a.done[q.from.id] = null; save(); return answer('Counted! +1 raid 💊'); }
        a.done[q.from.id] = nameOf(q.from);
        const p = raid().points[q.from.id] || (raid().points[q.from.id] = { name: nameOf(q.from), raids: 0 });
        p.name = nameOf(q.from); p.raids++;
        save();
        return answer('Counted! +1 raid 💊');
    }

    // Cada 30 s: refresca contadores y mensaje; cierra al cumplir los dos objetivos o al acabarse el tiempo.
    async function tick() {
        const a = raid().active;
        if (!a) return;
        try { a.cur = await counts(a.id); } catch (e) { log('raid: contadores ' + e.message); }
        const met = a.cur.likes >= a.goals.likes && a.cur.reposts >= a.goals.reposts;
        if (met || now() > a.endsAt) return finish(a);
        await edit(a, false);
    }

    return { onCommand, onCallback, tick, active: () => raid().active };
}

module.exports = { createRaid, TWEET_RE };
