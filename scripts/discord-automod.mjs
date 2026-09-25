// AutoMod del Discord de PillWars (spam, menciones, insultos, estafas y enlaces ajenos). Idempotente.
//   node scripts/discord-automod.mjs
import { readFileSync } from 'node:fs';
const TOKEN = readFileSync('C:/Users/34679/pillwars-bots/discord-token.txt', 'utf8').trim();
const G = '1552774307938304002', API = 'https://discord.com/api/v10';
const api = async (method, path, body) => { const r = await fetch(API + path, { method, headers: { Authorization: 'Bot ' + TOKEN, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); const j = r.status === 204 ? null : await r.json(); if (!r.ok) throw new Error(path + ' ' + JSON.stringify(j)); return j; };
const ch = await api('GET', `/guilds/${G}/channels`);
const team = ch.find(c => c.name === 'team').id;
const roles = await api('GET', `/guilds/${G}/roles`);
const exempt = roles.filter(r => ['Team', 'Mod'].includes(r.name)).map(r => r.id);
const block = msg => [{ type: 1, metadata: { custom_message: msg } }, { type: 2, metadata: { channel_id: team } }];
const RULES = [
  { name: 'Spam', trigger_type: 3, actions: block('Blocked as spam.') },
  { name: 'Mention spam', trigger_type: 5, trigger_metadata: { mention_total_limit: 5, mention_raid_protection_enabled: true }, actions: [...block('Too many mentions.'), { type: 3, metadata: { duration_seconds: 600 } }] },
  { name: 'Bad words', trigger_type: 4, trigger_metadata: { presets: [1, 2, 3] }, actions: block('Watch your language.') },
  { name: 'Scams and invites', trigger_type: 1, trigger_metadata: {
      keyword_filter: ['*seed phrase*', '*private key*', '*recovery phrase*', '*free nitro*', '*nitro gift*', '*claim your airdrop*', '*wallet connect*', '*validate wallet*', '*dm me*', '*dm for support*', '*support ticket*', '*inbox me*', '*check your dm*', '*collab*', '*partnership*', '*promote your*', '*marketing*', '*support team*', '*contact support*', '*customer support*', '*helpdesk*', '*technical support*', '*raise a ticket*', '*official support*', '*admin will dm*', '*message me privately*', '*validate your wallet*', '*sync your wallet*', '*rectif*', '*import your wallet*', '*secret phrase*', '*12 words*', '*24 words*', '*walletconnect*', '*guaranteed profit*', '*double your*', '*account manager*', '*volume bot*', '*increase your holders*', '*boost your project*'],
      regex_patterns: ['discord(\.gg|(app)?\.com/invite)/[\w-]+', 't\.me/\+?[\w-]+'],
      allow_list: ['discord.gg/rfZK7fQ32E', 't.me/pillwars_fun', 't.me/pillwars_announcements'],
    }, actions: block('Blocked: possible scam or outside link. Collabs and support go through #contact. The team never DMs first.') },
];
const existing = await api('GET', `/guilds/${G}/auto-moderation/rules`);
for (const r of RULES) {
  const body = { ...r, event_type: 1, enabled: true, exempt_roles: exempt, exempt_channels: [team] };
  const old = existing.find(e => e.name === r.name);
  const res = old ? await api('PATCH', `/guilds/${G}/auto-moderation/rules/${old.id}`, body) : await api('POST', `/guilds/${G}/auto-moderation/rules`, body);
  console.log('ok', res.name);
}
