'use strict';
// Botones del Discord de PillWars (verify y tickets) por "Interactions Endpoint URL":
// Discord hace POST a /discord/interactions en cada clic, firmado con ed25519.
// No hace falta proceso de bot conectado al gateway, solo el servidor web.
// Se activa con DISCORD_PUBLIC_KEY (la del portal, no es secreta) y
// DISCORD_BOT_TOKEN (secreto: añadir rol y crear canales de ticket).
const crypto = require('crypto');

// IDs del servidor (no son secretos). Los crea scripts/discord-setup.mjs.
const GUILD = '1552774307938304002';
const ROLE = { team: '1552778659931103292', mod: '1552778660983869560', player: '1552778663433474098', hunter: '1552970468666114048' };
const TICKETS_CATEGORY = 'TICKETS';
const X_FEED = '1552813555902972095';   // #x-feed: cada post nuevo de X
const TICKET_KINDS = { collab: 'Collab / partnership', bug: 'Bug report', support: 'Support', other: 'Other' };

const API = 'https://discord.com/api/v10';
const EPHEMERAL = 64;
const VIEW = 1n << 10n, SEND = 1n << 11n, HISTORY = 1n << 16n, ATTACH = 1n << 15n, EMBED = 1n << 14n;
const TICKET_ALLOW = (VIEW | SEND | HISTORY | ATTACH | EMBED).toString();

function publicKeyObject(hex) {
    // Clave ed25519 cruda (32 B) envuelta en SPKI para que la acepte crypto.
    return crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
}

function verifyRequest(key, sigHex, timestamp, rawBody) {
    if (!sigHex || !timestamp || !/^[0-9a-f]{128}$/i.test(sigHex)) return false;
    try { return crypto.verify(null, Buffer.concat([Buffer.from(String(timestamp)), rawBody]), key, Buffer.from(sigHex, 'hex')); }
    catch { return false; }
}

function createDiscord({ publicKey, token, log = () => {}, fetchImpl = fetch, claimHunter = () => ({ error: 'off' }) } = {}) {
    if (!publicKey) return { handle: async () => false, postXFeed: async () => {}, enabled: false };
    const key = publicKeyObject(publicKey);

    async function api(method, path, body) {
        const r = await fetchImpl(API + path, {
            method,
            headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (r.status === 204) return null;
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(method + ' ' + path + ' -> ' + r.status + ' ' + JSON.stringify(j));
        return j;
    }
    // Respuesta diferida: se contesta al instante y se edita cuando acaba el trabajo.
    const editReply = (it, content) => api('PATCH', '/webhooks/' + it.application_id + '/' + it.token + '/messages/@original', { content });

    const isStaff = m => (m.roles || []).some(r => r === ROLE.team || r === ROLE.mod) || (BigInt(m.permissions || 0) & 8n) === 8n;

    async function openTicket(it, kind) {
        const user = it.member.user;
        const channels = await api('GET', '/guilds/' + GUILD + '/channels');
        const cat = channels.find(c => c.type === 4 && c.name.includes(TICKETS_CATEGORY));
        if (!cat) throw new Error('falta la categoría de tickets');
        const open = channels.find(c => c.parent_id === cat.id && (c.topic || '').includes('uid:' + user.id));
        if (open) return editReply(it, 'You already have an open ticket: <#' + open.id + '>');
        const slug = String(user.username || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
        const ch = await api('POST', '/guilds/' + GUILD + '/channels', {
            name: kind + '-' + slug, type: 0, parent_id: cat.id,
            topic: TICKET_KINDS[kind] + ' ticket · uid:' + user.id,
            permission_overwrites: [
                { id: GUILD, type: 0, allow: '0', deny: VIEW.toString() },
                { id: ROLE.player, type: 0, allow: '0', deny: VIEW.toString() },
                { id: user.id, type: 1, allow: TICKET_ALLOW, deny: '0' },
                { id: ROLE.mod, type: 0, allow: TICKET_ALLOW, deny: '0' },
                { id: ROLE.team, type: 0, allow: TICKET_ALLOW, deny: '0' },
            ],
        });
        await api('POST', '/channels/' + ch.id + '/messages', {
            content: '<@' + user.id + '> thanks for reaching out! <@&' + ROLE.mod + '> will answer here.\n\n**' + TICKET_KINDS[kind] + '** — tell us everything in this channel: what you need, links, screenshots. Only you and the team can see it.\n\nRemember: the team will never ask for your seed phrase or private key.',
            allowed_mentions: { users: [user.id], roles: [ROLE.mod] },
            components: [{ type: 1, components: [{ type: 2, style: 4, label: 'Close ticket', custom_id: 'ticket-close', emoji: { name: '🔒' } }] }],
        });
        log('discord: ticket ' + kind + ' abierto por ' + user.id);
        return editReply(it, 'Ticket created: <#' + ch.id + '>');
    }

    async function onInteraction(it) {
        if (it.type === 1) return { type: 1 };                           // PING de validación
        if ((it.type !== 3 && it.type !== 5) || it.guild_id !== GUILD || !it.member) return { type: 4, data: { content: 'Not available here.', flags: EPHEMERAL } };
        const id = it.data && it.data.custom_id;
        const uid = it.member.user.id;

        // Genesis Hunter: the button opens a form, the form brings the code from the airdrop page.
        if (id === 'hunter' && it.type === 3) {
            return { type: 9, data: { custom_id: 'hunter', title: 'Claim Genesis Hunter', components: [{ type: 1, components: [
                { type: 4, custom_id: 'code', style: 1, label: 'Your code from pillwars.fun', placeholder: 'GH-XXXXXXXX', min_length: 11, max_length: 11, required: true },
            ] }] } };
        }
        if (id === 'hunter' && it.type === 5) {
            const code = (((it.data.components || [])[0] || {}).components || [])[0];
            const r = claimHunter(code && code.value, uid);
            if (r.error) {
                const why = { bad_code: 'That code does not exist. Copy it again from the JOIN DISCORD quest on pillwars.fun.', discord_used: 'This Discord account already claimed with another airdrop account.', code_used: 'That code was already used by another Discord account.' };
                return { type: 4, data: { content: '❌ ' + (why[r.error] || 'Something went wrong, please try again in a minute.'), flags: EPHEMERAL } };
            }
            await api('PUT', '/guilds/' + GUILD + '/members/' + uid + '/roles/' + ROLE.hunter);
            log('discord: genesis hunter ' + uid);
            return { type: 4, data: { content: '🎯 You are a **Genesis Hunter**! Boost quest done. Refresh pillwars.fun to see it.', flags: EPHEMERAL } };
        }
        if (id === 'verify') {
            if ((it.member.roles || []).includes(ROLE.player)) return { type: 4, data: { content: 'You are already verified ✅', flags: EPHEMERAL } };
            await api('PUT', '/guilds/' + GUILD + '/members/' + uid + '/roles/' + ROLE.player);
            log('discord: verify ' + uid);
            return { type: 4, data: { content: 'Verified ✅ Welcome to PillWars! The whole server is open for you now.', flags: EPHEMERAL } };
        }
        if (id && id.startsWith('ticket:') && TICKET_KINDS[id.slice(7)]) {
            openTicket(it, id.slice(7)).catch(e => { log('discord: ticket falló ' + e.message); editReply(it, 'Something went wrong, please try again in a minute.').catch(() => {}); });
            return { type: 5, data: { flags: EPHEMERAL } };
        }
        if (id === 'ticket-close') {
            const topic = (it.channel && it.channel.topic) || '';
            if (!isStaff(it.member) && !topic.includes('uid:' + uid)) return { type: 4, data: { content: 'Only the team or whoever opened this ticket can close it.', flags: EPHEMERAL } };
            setTimeout(() => api('DELETE', '/channels/' + it.channel_id).catch(e => log('discord: cerrar ticket falló ' + e.message)), 3000);
            log('discord: ticket cerrado ' + it.channel_id + ' por ' + uid);
            return { type: 4, data: { content: '🔒 Ticket closed by <@' + uid + '>. This channel will be deleted in a few seconds.', allowed_mentions: { parse: [] } } };
        }
        return { type: 4, data: { content: 'Unknown button.', flags: EPHEMERAL } };
    }

    async function handle(req, res, urlPath) {
        if (urlPath !== '/discord/interactions') return false;
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
        const chunks = []; let size = 0;
        for await (const c of req) { size += c.length; if (size > 64 * 1024) { res.writeHead(413); res.end(); return true; } chunks.push(c); }
        const raw = Buffer.concat(chunks);
        if (!verifyRequest(key, req.headers['x-signature-ed25519'], req.headers['x-signature-timestamp'], raw)) {
            res.writeHead(401); res.end('invalid request signature'); return true;
        }
        let out;
        try { out = await onInteraction(JSON.parse(raw.toString('utf8'))); }
        catch (e) { log('discord: ' + e.message); out = { type: 4, data: { content: 'Something went wrong, please try again in a minute.', flags: EPHEMERAL } }; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
        return true;
    }

    // Post nuevo de X en #x-feed. Solo el enlace: fixupx ya trae texto, foto y vídeo en el embed.
    const postXFeed = url => api('POST', '/channels/' + X_FEED + '/messages', { content: '**New post on 𝕏**\n❤️ Like · 🔁 RT · 💬 Reply 👇\n' + url });

    return { handle, postXFeed, enabled: true };
}

module.exports = { createDiscord, verifyRequest, publicKeyObject };
