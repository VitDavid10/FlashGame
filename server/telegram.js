'use strict';
// Canal de Telegram de PillWars: todo anuncio queda fijado, en el canal y en el grupo del chat.
// Canal por id (no por @usuario, que puede cambiar de dueño).
// - Posts que publica el equipo en el canal: el bot los recibe (getUpdates) y los fija.
// - Posts nuevos de X (@pillwarsdotfun, sin respuestas ni reposts): el bot los publica y los fija.
// Se activa con TELEGRAM_BOT_TOKEN. Solo corre en el proceso director/mono.
const fs = require('fs');

// Llamada a la acción debajo de cada post de X reenviado (Telegram y #x-feed del Discord).
const X_CTA = '❤️ Like · 🔁 RT · 💬 Reply';

function createTelegram({ token, chat = -1004433617369, group = -1004327296311, admin = 1437029421, xHandle = 'pillwarsdotfun', stateFile, log = () => {}, fetchImpl = fetch, xEveryMs = 5 * 60e3, onXPost = async () => {} } = {}) {
    if (!token) { const off = async () => { throw new Error('telegram off'); }; return { start() {}, enabled: false, inbox: () => [], thread: () => null, send: off, sendFile: off, file: off }; }
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
            if (m.pinned_message) return tg('deleteMessage', { chat_id: group, message_id: m.message_id });
            return groupAnswer(m);
        }
        if (m && m.chat.type === 'private') return onPrivate(m);
    }

    // Respuestas automáticas a lo típico. Una por tema y persona cada 24 h; el mensaje
    // le llega igual al admin, marcado con 🤖. Textos revisados a mano: nada de precios ni promesas.
    const AUTO = [
        { id: 'contract', re: /\b(ca|contract|token address|presale|pre-sale|launch date|when launch|when token|buy \$?pilly|price)\b/i,
          text: "$PILLY isn't live yet. The contract address will only be posted in our announcements channel (t.me/pillwars_announcements) and on X (@pillwarsdotfun).\n\nThere is no presale. Anyone offering one is a scammer." },
        { id: 'marketing', re: /\b(marketing|promot\w*|listing|trending|kols?|calls?|call channel|volume|shill\w*|advertis\w*|collab\w*|partnership)\b/i,
          text: "Thanks for reaching out! 🙌 We're not running paid promotions right now.\n\nIf you have a collab idea, send us the details here (who you are, your audience and what you propose) and the team will review it." },
        { id: 'links', re: /\b(twitter|x account|discord|telegram|website|site|links?|socials?)\b/i,
          text: 'Here are our official links 👇\n\n🐦 X: https://x.com/pillwarsdotfun\n👾 Discord: https://discord.gg/rfZK7fQ32E\n📢 Announcements: https://t.me/pillwars_announcements\n💬 Community chat: https://t.me/pillwars_fun' },
        { id: 'airdrop', re: /\b(airdrop|genesis|points|eligible|claim|snapshot)\b/i,
          text: 'All the airdrop details will be announced in t.me/pillwars_announcements and on our X (@pillwarsdotfun). Stay tuned 👀' },
    ];
    const SOLVED = new Set(['contract', 'links', 'airdrop']);
    const ACK = { id: 'ack', text: 'Got it! 🙌 The team will get back to you here soon.' };
    async function autoReply(m) {
        const text = m.text || m.caption || '';
        // Sin tema reconocido: acuse de recibo, para que nadie se quede esperando sin saber si le leen.
        const rule = AUTO.find(r => r.re.test(text)) || ACK;
        state.autoSent = state.autoSent || {};
        const key = m.from.id + ':' + rule.id, now = Date.now();
        if (now - (state.autoSent[key] || 0) < 24 * 3600e3) return null;
        state.autoSent[key] = now;
        for (const [k, t] of Object.entries(state.autoSent)) if (now - t > 24 * 3600e3) delete state.autoSent[k];
        await tg('sendMessage', { chat_id: m.chat.id, text: rule.text, link_preview_options: { is_disabled: true } });
        logMsg(m.from.id, null, 'bot', rule.text);
        return rule;
    }

    // En el grupo: contrato, enlaces y airdrop se contestan en respuesta al que pregunta, pero
    // como mucho una vez cada 10 min por tema para todo el grupo (si 4 piden el CA, se contesta al primero).
    async function groupAnswer(m) {
        if (!m.from || m.from.is_bot || m.sender_chat) return;       // bots, el canal y admins anónimos
        const rule = AUTO.find(r => SOLVED.has(r.id) && r.re.test(m.text || m.caption || ''));
        if (!rule) return;
        state.groupSent = state.groupSent || {};
        const now = Date.now();
        if (now - (state.groupSent[rule.id] || 0) < 10 * 60e3) return;
        state.groupSent[rule.id] = now; save();
        return tg('sendMessage', { chat_id: group, text: rule.text, reply_parameters: { message_id: m.message_id }, link_preview_options: { is_disabled: true } });
    }

    // Soporte por privado sin enseñar la cuenta del equipo: lo que la gente escribe
    // al bot le llega al admin; el admin contesta con "responder" y el bot se lo manda
    // a la persona como si fuera suyo. state.relay: id del mensaje en el chat del admin → id de la persona.
    const mark = (id, emoji) => tg('setMessageReaction', { chat_id: admin, message_id: id, reaction: [{ type: 'emoji', emoji }] }).catch(() => {});
    // /pending: una línea por persona esperando, colgada de su último mensaje (al pulsarla, salta a él).
    async function listPending() {
        const list = Object.entries(state.pending || {}).sort((a, b) => a[1].at - b[1].at);
        if (!list.length) return tg('sendMessage', { chat_id: admin, text: 'Nobody is waiting 🎉' });
        await tg('sendMessage', { chat_id: admin, text: '⏳ ' + list.length + ' waiting for an answer:' });
        for (const [uid, p] of list) {
            const line = await tg('sendMessage', { chat_id: admin, text: '⏳ ' + p.who + ' · ' + p.ids.length + ' msg', reply_parameters: { message_id: p.ids[p.ids.length - 1], allow_sending_without_reply: true } });
            state.relay[line.message_id] = Number(uid);   // responder a la línea también le contesta
        }
        save();
    }

    // Contestar abre (o mantiene) la conversación: lo que responda esa persona llega siempre,
    // y sus mensajes pendientes pasan de 👀 a 👌.
    async function answered(to) {
        state.lastFrom = state.lastFrom || {};
        state.lastFrom[to] = Date.now();
        const pend = (state.pending || {})[to];
        if (pend) {
            delete state.pending[to];
            for (const id of pend.ids) await mark(id, '👌');
        }
        save();
    }

    // Historial por persona para el inbox del panel de admin: los 200 últimos mensajes
    // de las 300 conversaciones más recientes. dir: 'in' (la persona), 'out' (el equipo), 'bot' (automático).
    const MEDIA = ['photo', 'video', 'animation', 'sticker', 'voice', 'audio', 'video_note', 'document'];
    const describe = m => m.text || m.caption || '';
    // Adjunto del mensaje: solo el file_id de Telegram; el archivo se pide a Telegram al verlo (ver file()).
    const mediaOf = m => {
        const kind = MEDIA.find(k => m[k]);
        if (!kind) return null;
        const f = kind === 'photo' ? m.photo[m.photo.length - 1] : m[kind];
        return { kind, file_id: f.file_id, mime: f.mime_type || '', name: f.file_name || '', size: f.file_size || 0 };
    };
    function logMsg(uid, who, dir, text, media) {
        state.convos = state.convos || {};
        const c = state.convos[uid] || (state.convos[uid] = { who: String(uid), msgs: [] });
        if (who) c.who = who;
        c.at = Date.now();
        c.msgs.push(media ? { t: c.at, dir, text, media } : { t: c.at, dir, text });
        if (c.msgs.length > 200) c.msgs.splice(0, c.msgs.length - 200);
        if (dir === 'in') c.unread = true;
        if (dir === 'out') c.unread = false;
        const ids = Object.keys(state.convos);
        if (ids.length > 300) ids.sort((a, b) => state.convos[a].at - state.convos[b].at).slice(0, ids.length - 300).forEach(k => delete state.convos[k]);
    }
    const last = c => c.msgs[c.msgs.length - 1] || {};
    const inbox = () => Object.entries(state.convos || {})
        .map(([id, c]) => ({ id, who: c.who, at: c.at, unread: !!c.unread, last: last(c).text || (last(c).media ? '[' + last(c).media.kind + ']' : ''), lastDir: last(c).dir }))
        .sort((a, b) => b.at - a.at);
    const thread = id => { const c = (state.convos || {})[id]; return c ? { id: String(id), who: c.who, msgs: c.msgs } : null; };
    // Responder desde el inbox web: le llega como "PillWars Team", igual que desde Telegram.
    async function send(id, text) {
        text = String(text || '').trim().slice(0, 4000);
        if (!text || !(state.convos || {})[id]) throw new Error('bad request');
        await tg('sendMessage', { chat_id: Number(id), text });
        logMsg(Number(id), null, 'out', text);
        await answered(Number(id));
    }
    // Foto/vídeo/archivo desde el inbox web (el texto de la caja va como pie).
    async function sendFile(id, buf, mime, name, caption) {
        if (!(state.convos || {})[id] || !buf.length) throw new Error('bad request');
        const [method, field] = mime === 'image/gif' ? ['sendAnimation', 'animation']
            : mime.startsWith('image/') ? ['sendPhoto', 'photo']
            : mime.startsWith('video/') ? ['sendVideo', 'video']
            : mime.startsWith('audio/') ? ['sendAudio', 'audio'] : ['sendDocument', 'document'];
        const form = new FormData();
        form.append('chat_id', String(id));
        if (caption) form.append('caption', String(caption).slice(0, 1000));
        form.append(field, new Blob([buf], { type: mime || 'application/octet-stream' }), name || 'file');
        const r = await fetchImpl('https://api.telegram.org/bot' + token + '/' + method, { method: 'POST', body: form }).then(x => x.json());
        if (!r.ok) throw new Error(method + ': ' + r.description);
        logMsg(Number(id), null, 'out', caption || '', mediaOf(r.result));
        await answered(Number(id));
    }
    // Descarga de un adjunto para verlo en el inbox. Telegram solo deja bajar hasta 20 MB a los bots.
    async function file(fileId) {
        const f = await tg('getFile', { file_id: String(fileId) });
        const r = await fetchImpl('https://api.telegram.org/file/bot' + token + '/' + f.file_path);
        if (!r.ok) throw new Error('download ' + r.status);
        return { body: Buffer.from(await r.arrayBuffer()), path: f.file_path };
    }

    async function onPrivate(m) {
        if (m.from.id === admin) {
            if (m.text === '/start') return tg('sendMessage', { chat_id: admin, text: 'You are the admin 👋\n\nWhen someone writes to this bot, their message shows up here. Reply to it (swipe or right click → Reply) and they get your answer from "PillWars Team".\n\n👀 = not answered yet, 👌 = answered. Send /pending to see who is waiting.' });
            if (m.text === '/pending') return listPending();
            const to = m.reply_to_message && (state.relay || {})[m.reply_to_message.message_id];
            if (!to) return tg('sendMessage', { chat_id: admin, text: 'To answer someone, reply (swipe or right click → Reply) to their message.' });
            await tg('copyMessage', { chat_id: to, from_chat_id: admin, message_id: m.message_id });
            logMsg(to, null, 'out', describe(m), mediaOf(m));
            await answered(to);
            return tg('setMessageReaction', { chat_id: admin, message_id: m.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] }).catch(() => {});
        }
        if (m.text === '/start') {
            return tg('sendMessage', { chat_id: m.chat.id, text: 'Hi! 💊 This is PillWars support.\n\nWrite your message here and the team will answer you right here.\n\n⚠️ We will never ask for your seed phrase or private key.' });
        }
        const who = [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') + (m.from.username ? ' (@' + m.from.username + ')' : '');
        logMsg(m.from.id, who, 'in', describe(m), mediaOf(m));
        const auto = await autoReply(m);
        state.lastFrom = state.lastFrom || {};
        state.headOf = state.headOf || {};
        const now = Date.now(), since = now - (state.lastFrom[m.from.id] || 0);
        // Contrato, enlaces y airdrop quedan resueltos con la respuesta automática y no llenan el
        // chat del admin... salvo en mitad de una conversación (últimas 24 h): entonces llega todo.
        if (auto && SOLVED.has(auto.id) && since > 24 * 3600e3) { save(); return; }
        state.lastFrom[m.from.id] = now;
        for (const [k, t] of Object.entries(state.lastFrom)) if (now - t > 24 * 3600e3) { delete state.lastFrom[k]; delete state.headOf[k]; }
        state.relay = state.relay || {};
        // Cabecera "💬 nombre" al empezar conversación (15 min sin escribir). Cada mensaje llega como
        // respuesta a la cabecera de su autor: aunque escriban varios a la vez, se ve de quién es.
        if (since > 15 * 60e3 || !state.headOf[m.from.id]) {
            const head = await tg('sendMessage', { chat_id: admin, text: '💬 ' + who + ' · id ' + m.from.id });
            state.relay[head.message_id] = m.from.id;
            state.headOf[m.from.id] = head.message_id;
        }
        const copy = await tg('copyMessage', { chat_id: admin, from_chat_id: m.chat.id, message_id: m.message_id, reply_parameters: { message_id: state.headOf[m.from.id], allow_sending_without_reply: true } });
        state.relay[copy.message_id] = m.from.id;
        // Lo que el bot le ha contestado solo, entero, colgado de su mensaje: para saber qué ha leído ya.
        if (auto) {
            const note = await tg('sendMessage', { chat_id: admin, text: '🤖 The bot already answered:\n\n' + auto.text, reply_parameters: { message_id: copy.message_id }, link_preview_options: { is_disabled: true } });
            state.relay[note.message_id] = m.from.id;
        }
        // Sin contestar hasta que el admin le responda: 👀 en el mensaje y a la lista de /pending.
        state.pending = state.pending || {};
        const p = state.pending[m.from.id] || (state.pending[m.from.id] = { who, ids: [] });
        p.ids.push(copy.message_id); p.at = now;
        await mark(copy.message_id, '👀');
        // Tope para que el estado no crezca sin fin: se quedan las 1000 más recientes.
        const keys = Object.keys(state.relay);
        if (keys.length > 1000) for (const k of keys.slice(0, keys.length - 1000)) delete state.relay[k];
        save();
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
            const m = await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: '<b>New post on 𝕏</b>\n\n' + esc(t.text) + '\n\n' + X_CTA + '\n' + url });
            await pin(m.message_id);
            state.lastTweet = t.id; save();
            await onXPost(url).catch(e => log('telegram: onXPost ' + e.message));
            log('telegram: post de X reenviado ' + t.id);
        }
    }

    function start() {
        pollUpdates();
        const tick = () => checkX().catch(e => log('telegram: X ' + e.message));
        tick();
        setInterval(tick, xEveryMs).unref();
    }

    return { start, onUpdate, checkX, inbox, thread, send, sendFile, file, enabled: true };
}

module.exports = { createTelegram, X_CTA };
