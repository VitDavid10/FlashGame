'use strict';
// Canal de Telegram de PillWars: todo anuncio queda fijado, en el canal y en el grupo del chat.
// Canal por id (no por @usuario, que puede cambiar de dueño).
// - Posts que publica el equipo en el canal: el bot los recibe (getUpdates) y los fija.
// - Posts nuevos de X (@pillwarsdotfun, sin respuestas ni reposts): el bot los publica y los fija.
// Se activa con TELEGRAM_BOT_TOKEN. Solo corre en el proceso director/mono.
const fs = require('fs');

function createTelegram({ token, chat = -1004433617369, group = -1004327296311, xHandle = 'pillwarsdotfun', stateFile, log = () => {}, fetchImpl = fetch, xEveryMs = 5 * 60e3 } = {}) {
    if (!token) return { start() {}, enabled: false };
    let state = {};
    try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
    const save = () => { try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch (e) { log('telegram: no se pudo guardar el estado ' + e.message); } };

    async function tg(method, body) {
        const r = await fetchImpl('https://api.telegram.org/bot' + token + '/' + method, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
        }).then(x => x.json());
        if (!r.ok) throw new Error(method + ': ' + r.description);
        return r.result;
    }
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const pin = (id, where = chat) => tg('pinChatMessage', { chat_id: where, message_id: id, disable_notification: true });

    // Canal: fijar los posts y borrar el aviso "X pinned a message".
    // Grupo del chat (conectado al canal): cada anuncio llega como reenvío automático y se fija también ahí.
    async function onUpdate(u) {
        const p = u.channel_post;
        if (p && p.chat.id === chat) {
            if (p.pinned_message) return tg('deleteMessage', { chat_id: chat, message_id: p.message_id });
            return pin(p.message_id);
        }
        const m = u.message;
        if (m && m.chat.id === group) {
            if (m.is_automatic_forward) return pin(m.message_id, group);
            if (m.pinned_message && m.from && m.from.is_bot) return tg('deleteMessage', { chat_id: group, message_id: m.message_id });
        }
    }

    async function pollUpdates() {
        for (;;) {
            try {
                const ups = await tg('getUpdates', { offset: state.offset || 0, timeout: 50, allowed_updates: ['channel_post', 'message'] });
                for (const u of ups) {
                    state.offset = u.update_id + 1;
                    await onUpdate(u).catch(e => log('telegram: ' + e.message));
                }
                if (ups.length) save();
            } catch (e) {
                log('telegram: getUpdates ' + e.message);
                await new Promise(r => setTimeout(r, 30e3));
            }
        }
    }

    async function checkX() {
        const j = await fetchImpl('https://api.fxtwitter.com/2/profile/' + xHandle + '/statuses').then(r => r.json());
        const own = (j.results || []).filter(t => !t.replying_to && !t.reposted_by && t.author && String(t.author.screen_name).toLowerCase() === xHandle.toLowerCase());
        if (!own.length) return;
        const newest = own.reduce((m, t) => (BigInt(t.id) > BigInt(m) ? t.id : m), '0');
        // Primera vez: se toma nota del último post sin volcar al canal todo el historial.
        if (!state.lastTweet) { state.lastTweet = newest; save(); return; }
        const fresh = own.filter(t => BigInt(t.id) > BigInt(state.lastTweet)).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        for (const t of fresh) {
            // fixupx.com: Telegram enseña la foto o el vídeo del post en la vista previa; al pulsar lleva a X.
            const url = t.url.replace(/^https:\/\/(x|twitter)\.com\//, 'https://fixupx.com/');
            const m = await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: '<b>New post on 𝕏</b>\n\n' + esc(t.text) + '\n\n' + url });
            await pin(m.message_id);
            state.lastTweet = t.id; save();
            log('telegram: post de X reenviado ' + t.id);
        }
    }

    function start() {
        pollUpdates();
        const tick = () => checkX().catch(e => log('telegram: X ' + e.message));
        tick();
        setInterval(tick, xEveryMs).unref();
    }

    return { start, onUpdate, checkX, enabled: true };
}

module.exports = { createTelegram };
