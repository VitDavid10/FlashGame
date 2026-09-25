// Monta (o actualiza) el servidor de Discord de PillWars: roles, permisos, canales y textos.
// Idempotente: reutiliza lo que ya existe por nombre y re-publica los textos del bot.
//   node scripts/discord-setup.mjs
// Token: C:\Users\34679\pillwars-bots\discord-token.txt (o DISCORD_TOKEN_FILE).
import { readFileSync } from 'node:fs';

const TOKEN = readFileSync(process.env.DISCORD_TOKEN_FILE || 'C:/Users/34679/pillwars-bots/discord-token.txt', 'utf8').trim();
const GUILD = '1552774307938304002';
const API = 'https://discord.com/api/v10';
const INVITE = 'https://discord.gg/rfZK7fQ32E';
// Genesis Drop visible? false = #genesis-drop and #flex-and-refs are staff only and
// no other text mentions the airdrop. Set to true and run again on launch day.
const DROP_LIVE = false;
const live = (on, off = '') => (DROP_LIVE ? on : off);

async function api(method, path, body) {
  for (;;) {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: 'Bot ' + TOKEN, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 429) { const j = await r.json(); await new Promise(s => setTimeout(s, (j.retry_after || 1) * 1000 + 100)); continue; }
    if (r.status === 204) return null;
    const j = await r.json();
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j)}`);
    return j;
  }
}

const P = n => 1n << BigInt(n);
const VIEW = P(10), SEND = P(11), HISTORY = P(16), REACT = P(6), EMBED = P(14), ATTACH = P(15), EXT_EMOJI = P(18),
  CONNECT = P(20), SPEAK = P(21), VAD = P(25), CHANGE_NICK = P(26), APP_CMDS = P(31), PUB_THREADS = P(35),
  PRIV_THREADS = P(36), SEND_THREADS = P(38), MANAGE_MSG = P(13), KICK = P(1), BAN = P(2), MANAGE_NICK = P(27),
  MANAGE_THREADS = P(34), TIMEOUT = P(40), MENTION_ALL = P(17), ADMIN = P(3);
const s = b => b.toString();
const NO_SEND = SEND | SEND_THREADS | PUB_THREADS | PRIV_THREADS;

// ---- Roles y permisos base ----
// @everyone no ve nada: solo #rules, que abre con su overwrite. Verify da Player, que ve el resto.
const PLAYER_PERMS = VIEW | SEND | HISTORY | REACT | EMBED | ATTACH | EXT_EMOJI | CONNECT | SPEAK | VAD | CHANGE_NICK | APP_CMDS | PUB_THREADS | SEND_THREADS;
const MOD_PERMS = PLAYER_PERMS | MANAGE_MSG | KICK | BAN | MANAGE_NICK | MANAGE_THREADS | TIMEOUT;
const ROLE_DEFS = [
  { name: 'Team', color: 0xff4d6d, hoist: true, mentionable: false, permissions: s(ADMIN) },
  { name: 'Mod', color: 0xffb703, hoist: true, mentionable: true, permissions: s(MOD_PERMS) },
  { name: 'Tester', color: 0x4cc9f0, hoist: true, mentionable: false, permissions: '0' },
  { name: 'Player', color: 0x80ed99, hoist: false, mentionable: false, permissions: s(PLAYER_PERMS) },
  // Cosmetic: given by the "Claim Genesis Hunter" button in #genesis-drop (code from the airdrop page).
  { name: 'Genesis Hunter', color: 0xffce3d, hoist: false, mentionable: false, permissions: '0' },
];
const roles = await api('GET', `/guilds/${GUILD}/roles`);
const role = {};
for (const d of ROLE_DEFS) {
  const r = roles.find(x => x.name === d.name);
  role[d.name] = r ? await api('PATCH', `/guilds/${GUILD}/roles/${r.id}`, d) : await api('POST', `/guilds/${GUILD}/roles`, d);
}
await api('PATCH', `/guilds/${GUILD}/roles/${GUILD}`, { permissions: '0' });

// ---- Canales ----
let channels = await api('GET', `/guilds/${GUILD}/channels`);
const find = (name, type) => channels.find(c => c.name === name && c.type === type);
async function ensure(name, type, extra = {}) {
  const c = find(name, type);
  if (c) return api('PATCH', `/channels/${c.id}`, extra);
  const n = await api('POST', `/guilds/${GUILD}/channels`, { name, type, ...extra });
  channels.push(n);
  return n;
}
const ow = (id, allow = 0n, deny = 0n) => ({ id, type: 0, allow: s(allow), deny: s(deny) });
const everyone = GUILD;

const readOnlyForAll = [ow(everyone, VIEW | HISTORY | REACT, NO_SEND)];                // #rules
const readOnly = [ow(role.Player.id, 0n, NO_SEND)];                                    // info
const staffOnly = [ow(role.Player.id, 0n, VIEW), ow(role.Mod.id, VIEW)];               // equipo y tickets

const cat = {};
const CATS = [['📌 START HERE', []], ['📢 INFO', readOnly], ['💬 COMMUNITY', []], ['🎮 GAME', []], ['📨 SUPPORT', []], ['🔊 VOICE', []], ['🎫 TICKETS', staffOnly], ['🛠 TEAM', staffOnly]];
for (const [i, [name, perms]] of CATS.entries()) cat[name] = await ensure(name, 4, { position: i, permission_overwrites: perms });

const C = {};
// airdrop-refs was renamed: rename it in place so its messages stay.
{ const old = find('airdrop-refs', 0); if (old) Object.assign(old, await api('PATCH', `/channels/${old.id}`, { name: 'flex-and-refs' })); }
const defs = [
  ['rules', '📌 START HERE', 'Read the rules and press Verify to unlock the server.', readOnlyForAll],
  ['announcements', '📢 INFO', 'Official news. Contract address, dates and links are only official when posted here.', readOnly],
  ['minor-announcements', '📢 INFO', 'Smaller updates: patches, balance changes, events.', readOnly],
  ['official-links', '📢 INFO', 'Every official PillWars link. If it is not here, it is not us.', readOnly],
  ['genesis-drop', '📢 INFO', 'The Season 0 $PILLY airdrop: pool, points and how it is split.', live(readOnly, staffOnly)],
  ['faq', '📢 INFO', 'Frequently asked questions.', readOnly],
  ['roadmap', '📢 INFO', 'Where PillWars is going.', readOnly],
  ['x-feed', '📢 INFO', 'Every new post from our X, automatically.', readOnly],
  ['general', '💬 COMMUNITY', 'Talk about anything PillWars.', []],
  ['clips', '💬 COMMUNITY', 'Share your best plays and screenshots.', []],
  ['suggestions', '💬 COMMUNITY', 'Ideas for modes, skills, skins and features.', []],
  ['bugs', '💬 COMMUNITY', 'Public bug reports: device, browser and what happened. Private issues? Open a ticket in #contact.', []],
  ['flex-and-refs', '💬 COMMUNITY', 'Flex your points card and share your referral link here, and only here. Slow mode: one post per hour.', live([], staffOnly), { rate_limit_per_user: 3600 }],
  ['looking-to-play', '🎮 GAME', 'Find people to jump into a room with. Say mode (Arcade/Classic) and region.', []],
  ['strategy', '🎮 GAME', 'Tips, skill picks, split tricks and how to win the Daily Arena.', []],
  ['high-scores', '🎮 GAME', 'Flex your best runs. Screenshot or it did not happen.', []],
  ['contact', '📨 SUPPORT', 'Collabs, private bug reports, support: open a ticket with the buttons.', readOnlyForAll.map(o => ({ ...o, id: role.Player.id, allow: s(VIEW | HISTORY | REACT) }))],
  ['team', '🛠 TEAM', 'Team and mods only.', staffOnly],
];
for (const [i, [name, parent, topic, perms, extra]] of defs.entries()) {
  C[name] = await ensure(name, 0, { parent_id: cat[parent].id, position: i, topic, permission_overwrites: perms, ...(extra || {}) });
}
C.voice = await ensure('General', 2, { parent_id: cat['🔊 VOICE'].id, position: 0, permission_overwrites: [] });
C.voice2 = await ensure('Arena', 2, { parent_id: cat['🔊 VOICE'].id, position: 1, permission_overwrites: [] });

// Sobrantes de la primera versión y de la plantilla de Discord
channels = await api('GET', `/guilds/${GUILD}/channels`);
for (const name of ['welcome', 'Canales de texto', 'Canales de voz']) {
  const c = channels.find(x => x.name === name && !Object.values(C).some(k => k.id === x.id) && !Object.values(cat).some(k => k.id === x.id));
  if (c && !channels.some(x => x.parent_id === c.id)) await api('DELETE', `/channels/${c.id}`);
}

// ---- Textos ----
const ch = n => `<#${C[n].id}>`;
const RULES = `# Welcome to PillWars 💊
Read the rules below, then press **Verify** at the bottom to unlock the server.

## Rules
1. **Be respectful.** No harassment, hate speech or personal attacks.
2. **No spam or self-promo.** No ads and no invite links to other servers.${live(` Airdrop referral links go in ${ch('flex-and-refs')} only.`)}
3. **No scams.** The team will **never** DM you first, ask for your seed phrase or private key, or ask you to "verify" your wallet. Anyone who does is a scammer: report them in ${ch('contact')}.
4. **Official info only comes from ${ch('announcements')} and ${ch('official-links')}.** Contract addresses, dates and links posted anywhere else are not official.
5. **No financial talk.** Nothing here is financial advice. No price predictions or shilling.
6. **No cheating.** Don't share exploits, bots or hacks. Found one? Report it privately with a ticket in ${ch('contact')}.
7. **English in the main channels**, so everyone can follow.
8. **Keep it SFW.**

Breaking the rules can get you muted, kicked or banned. Mods have the final say.

By pressing Verify you agree to these rules.`;

const LINKS = `# Official links
If a link is not on this list, it is not us.

🌐 **Website:** <https://pillwars.fun>
${live(`🎁 **Genesis Drop (airdrop):** <https://pillwars.fun/airdrop>
`)}🐦 **X:** <https://x.com/pillwarsdotfun>
✈️ **Telegram community chat:** <https://t.me/pillwars_fun>
📢 **Telegram announcements:** <https://t.me/pillwars_announcements>
👾 **Discord:** <${INVITE}>
🏦 **Treasury (on-chain):** <https://pillwars.fun/treasury.html>
${live(`📜 **Airdrop terms:** <https://pillwars.fun/airdrop-terms>`)}

🪙 **$PILLY contract address:** not live yet. It will be posted **only** in ${ch('announcements')} and on our X. Any address you see before that is a scam.`;

const GENESIS = `# 🎁 Genesis Drop — Season 0
The Genesis Drop is the $PILLY airdrop for the first PillWars players.

## The pool
• **Total supply:** 1,000,000,000 $PILLY, fixed. No minting, ever.
• **Airdrop pool:** **100,000,000 $PILLY** (10% of the supply).
• The team buys the pool on the pump.fun bonding curve at launch, like anyone else. 0% team mint.
• The whole pool is split between everyone who took part, **in proportion to their points**.

## How much can you get?
**Your $PILLY = 100,000,000 × your points ÷ everyone's points**

Example: you finish with 10,000 points and all players together have 20,000,000 points. You get 100,000,000 × 10,000 ÷ 20,000,000 = **50,000 $PILLY**.
The fewer players or the more points you have, the bigger your share. The full 100M is always split: nothing stays with the team.

## Points
• **Solana wallet:** up to 29,800 (past Solana airdrops, Saga/Seeker Genesis Token, Mad Lads, wallet age, transactions)
• **X account:** up to 4,000 (followers, account age, verified)
• **Invites:** up to 8,000 (the friend must link a wallet 60+ days old with 50+ transactions)
• **Daily Arena:** up to 300 a day
• **Social quests:** daily post, sharing your points card, reposts and likes
• **Boost:** follow our X, join the Telegram, play your first match and claim the Genesis Hunter role at the bottom of this channel → **all your points ×1.5**

## Timeline
1. **Earn points** during Season 0. The end date will be announced in ${ch('announcements')}.
2. **Snapshot:** every balance is frozen.
3. **Sybil check:** bots, farms and duplicate accounts are removed.
4. **Launch:** $PILLY goes live and the pool is sent straight to your wallet. No claim needed.

Points are not tokens. Full rules: <https://pillwars.fun/airdrop-terms>
Start here: <https://pillwars.fun/airdrop>`;

const FAQ = `# ❓ FAQ

**What is PillWars?**
A free-to-play multiplayer .io arena game on Solana that runs in your browser. You are a pill: eat to grow, split, use skills and eat the other pills to become the biggest.

**Is it free?**
Yes. Free rooms are always free. Paid rooms in $PILLY will come after the token launches.

**Which modes are there?**
**Arcade:** a roguelike arena where you draft a skill every 30 seconds and the top 10 split the pot. **Classic:** a 15-minute match on a map twice as big, with only the shoot skill.

**Can I play on mobile?**
Yes, in the mobile browser. A Solana Seeker app is on the way.

${live(`**What is the Genesis Drop?**
The Season 0 airdrop: 100M $PILLY split by points. Everything is in ${ch('genesis-drop')}.

`)}**When does $PILLY launch? What is the contract address?**
${live('After the Season 0 snapshot. ', 'Soon. ')}The address will be posted only in ${ch('announcements')} and on our X. Anything before that is fake.

${live(`**Do I have to claim the airdrop?**
No. It is sent straight to the wallet you linked.

`)}**Is there a presale or private round?**
No. Fair launch on pump.fun, 0% team mint.

**Which wallet do I need?**
Any Solana wallet (Phantom, Solflare, Backpack…).

**Someone DMed me offering help or a "verification".**
It is a scam. The team never DMs first. Report it in ${ch('contact')}.

**I found a bug / I want to collaborate.**
Public bugs: ${ch('bugs')}. Private issues, collabs and partnerships: open a ticket in ${ch('contact')}.`;

const ROADMAP = `# 🗺️ Roadmap

**✅ Done**
• Multiplayer arena with an authoritative server (anti-cheat), Arcade and Classic modes
• Daily quests, skin shop, leaderboard
• On-chain treasury with a time lock on project funds
${live(`• Genesis Drop (Season 0) is live
`)}
**🔨 Now: Season 0**
${live(`• Earn airdrop points
`)}• Solana Seeker app (Solana dApp Store)
• Community: Discord, Telegram, events

**🔜 Next: launch**
${live(`• Snapshot and sybil check
`)}• $PILLY launch on pump.fun${live(', airdrop sent straight to wallets')}
• Paid rooms in $PILLY: eat a player, take their $PILLY
• Skin shop in $PILLY: every token spent is burned

**🔭 Later**
• Staking: lock $PILLY and share the fees from the rewards pool
• New seasons, modes and skills

Dates can change. Updates go to ${ch('announcements')}.`;

const CONTACT = `# 📨 Contact the team
Need to talk to us privately? Press a button and a private channel opens that only you and the team can see.

🤝 **Collab:** partnerships, creators, communities, press
🐛 **Bug:** bugs you'd rather not post in public, exploits
🛟 **Support:** problems with your account, wallet${live(' or airdrop points')}
💬 **Other:** anything else

One open ticket per person. The team will never ask for your seed phrase or private key.`;

async function repost(channel, messages) {
  const old = await api('GET', `/channels/${channel.id}/messages?limit=50`);
  for (const m of old) if (m.author.id === role.botId) await api('DELETE', `/channels/${channel.id}/messages/${m.id}`);
  for (const m of messages) {
    // Límite de 2000 caracteres por mensaje: se parte por párrafos y los botones van en el último trozo.
    const parts = [];
    for (const para of (m.content || '').split('\n\n')) {
      if (parts.length && parts[parts.length - 1].length + para.length + 2 <= 1900) parts[parts.length - 1] += '\n\n' + para;
      else parts.push(para);
    }
    for (const [i, content] of parts.entries()) {
      await api('POST', `/channels/${channel.id}/messages`, { allowed_mentions: { parse: [] }, ...(i === parts.length - 1 ? m : {}), content });
    }
  }
}
role.botId = (await api('GET', '/users/@me')).id;

await repost(C.rules, [
  { content: RULES },
  { components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Verify', custom_id: 'verify', emoji: { name: '✅' } }] }], content: '**Press to enter the server** 👇' },
]);
await repost(C['official-links'], [{ content: LINKS }]);
await repost(C['genesis-drop'], [
  { content: GENESIS },
  { content: '**🎯 Genesis Hunter**\nOpen the **JOIN DISCORD** quest on <https://pillwars.fun>, copy your code, press the button and paste it: you get the role and it counts toward your **×1.5 boost**.',
    components: [{ type: 1, components: [{ type: 2, style: 3, label: 'Claim Genesis Hunter', custom_id: 'hunter', emoji: { name: '🎯' } }] }] },
]);
await repost(C.faq, [{ content: FAQ }]);
await repost(C.roadmap, [{ content: ROADMAP }]);
await repost(C.contact, [{
  content: CONTACT,
  components: [{ type: 1, components: [
    { type: 2, style: 1, label: 'Collab', custom_id: 'ticket:collab', emoji: { name: '🤝' } },
    { type: 2, style: 4, label: 'Bug', custom_id: 'ticket:bug', emoji: { name: '🐛' } },
    { type: 2, style: 2, label: 'Support', custom_id: 'ticket:support', emoji: { name: '🛟' } },
    { type: 2, style: 2, label: 'Other', custom_id: 'ticket:other', emoji: { name: '💬' } },
  ] }],
}]);

// ---- Resumen ----
const final = await api('GET', `/guilds/${GUILD}/channels`);
for (const c of final.filter(c => c.type === 4).sort((a, b) => a.position - b.position)) {
  console.log(c.name);
  for (const x of final.filter(y => y.parent_id === c.id).sort((a, b) => a.position - b.position)) console.log('  ', x.type === 2 ? '🔊' : '#', x.name);
}
const orphans = final.filter(c => c.type !== 4 && !c.parent_id);
if (orphans.length) console.log('sin categoría:', orphans.map(c => c.name).join(', '));
console.log('roles:', (await api('GET', `/guilds/${GUILD}/roles`)).sort((a, b) => b.position - a.position).map(r => r.name).join(' > '));
