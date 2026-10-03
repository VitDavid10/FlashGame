'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { createRaid } = require('../server/raid.js');
const { createTelegram } = require('../server/telegram.js');

const GROUP = -1004327296311, ADMIN = 1437029421;
const URL1 = 'https://x.com/pillwarsdotfun/status/2106221216373817434';

function setup(counts = { likes: 2, retweets: 1 }) {
    const calls = []; let clock = 1e6, next = 700;
    const c = { ...counts };
    const tg = async (method, body) => { calls.push([method, body]); return method === 'sendMessage' ? { message_id: next++ } : true; };
    const fetchImpl = async url => ({ json: async () => (url.includes('/status/') ? { tweet: { likes: c.likes, retweets: c.retweets } } : {}) });
    const state = {};
    const r = createRaid({ tg, fetchImpl, state, save() {}, group: GROUP, admin: ADMIN, now: () => clock });
    return { r, calls, state, c, tick: ms => { clock += ms; } };
}
const cmd = (text, id = ADMIN) => ({ message_id: 5, text, from: { id } });
const anon = (text, chat = GROUP) => ({ message_id: 5, text, from: { id: 1087968824, is_bot: true }, sender_chat: { id: chat } });
const click = (id, name = 'u' + id, data = 'raid:done:2106221216373817434') => ({ id: 'q' + id, data, from: { id, username: name } });
const sent = calls => calls.filter(c => c[0] === 'sendMessage');

test('el admin lanza un raid: mensaje con botones y objetivos; los demás no pueden', async () => {
    const s = setup();
    assert.equal(await s.r.onCommand(cmd('/raid ' + URL1 + ' 50 20 30', 123)), true);
    assert.equal(sent(s.calls).length, 0);
    assert.equal(await s.r.onCommand(cmd('/raid@pillwars_bot ' + URL1 + ' 50 20 30')), true);
    const m = sent(s.calls)[0][1];
    assert.match(m.text, /RAID!/);
    assert.match(m.text, /Likes {2}2\/50/);
    assert.match(m.text, /Reposts {2}1\/20/);
    assert.match(m.text, /30 min left/);
    assert.equal(m.reply_markup.inline_keyboard[0][0].url, URL1);
    assert.equal(m.reply_markup.inline_keyboard[1][0].callback_data, 'raid:done:2106221216373817434');
    assert.equal(s.r.active().msgId, 700);
});

test('admin anónimo (escribe como el grupo) puede; otro canal o persona, no', async () => {
    const s = setup();
    await s.r.onCommand(anon('/raid ' + URL1, -100999));
    assert.equal(sent(s.calls).length, 0);
    await s.r.onCommand(anon('/raid ' + URL1));
    assert.equal(sent(s.calls).length, 1);
    await s.r.onCommand(anon('/raidend'));
    assert.equal(s.r.active(), null);
});

test('mensajes que no son comandos de raid no se tocan; link malo enseña la ayuda; un solo raid a la vez', async () => {
    const s = setup();
    assert.equal(await s.r.onCommand(cmd('hola')), false);
    assert.equal(await s.r.onCommand(cmd('/raid nada')), true);
    assert.match(sent(s.calls)[0][1].text, /To start a raid/);
    await s.r.onCommand(cmd('/raid ' + URL1));
    await s.r.onCommand(cmd('/raid ' + URL1));
    assert.match(sent(s.calls).at(-1)[1].text, /already running/);
});

test('"I did it": cuenta una vez por persona y suma a su marcador', async () => {
    const s = setup();
    await s.r.onCommand(cmd('/raid ' + URL1));
    await s.r.onCallback(click(1)); await s.r.onCallback(click(1)); await s.r.onCallback(click(2));
    const answers = s.calls.filter(c => c[0] === 'answerCallbackQuery').map(c => c[1].text);
    assert.deepEqual(answers, ['Counted! +1 raid 💊', "You're already counted ✅", 'Counted! +1 raid 💊']);
    assert.equal(Object.keys(s.r.active().done).length, 2);
    assert.equal(s.state.raid.points[1].raids, 1);
});

test('tick: refresca el avance y cierra al cumplir los objetivos (sin lista de raiders)', async () => {
    const s = setup();
    await s.r.onCommand(cmd('/raid ' + URL1 + ' 5 3'));
    await s.r.onCallback(click(1, 'ana'));
    s.c.likes = 4; await s.r.tick();
    const e1 = s.calls.filter(c => c[0] === 'editMessageText').at(-1)[1];
    assert.match(e1.text, /Likes {2}4\/5/);
    assert.doesNotMatch(e1.text, /Raiders/);
    assert.ok(s.r.active());
    s.c.likes = 5; s.c.retweets = 3; await s.r.tick();
    // el resultado va en un mensaje nuevo (abajo del todo) y el del raid se borra
    const e2 = sent(s.calls).at(-1)[1];
    assert.match(e2.text, /RAID COMPLETE/);
    assert.doesNotMatch(e2.text, /Raiders|@ana/);
    assert.deepEqual(s.calls.at(-1), ['deleteMessage', { chat_id: GROUP, message_id: 700 }]);
    assert.equal(s.r.active(), null);
    await s.r.onCallback(click(9));
    assert.equal(s.calls.at(-1)[1].text, 'This raid is over 🏁');
});

test('tick: al acabarse el tiempo termina sin objetivos; /raidend lo corta antes; /raidtop lista', async () => {
    const s = setup();
    await s.r.onCommand(cmd('/raid ' + URL1 + ' 50 20 10'));
    await s.r.onCallback(click(1, 'ana'));
    s.tick(11 * 60e3); await s.r.tick();
    assert.match(sent(s.calls).at(-1)[1].text, /RAID ENDED/);
    await s.r.onCommand(cmd('/raid ' + URL1));
    await s.r.onCommand(cmd('/raidend'));
    assert.match(sent(s.calls).at(-1)[1].text, /RAID ENDED/);
    await s.r.onCommand(cmd('/raidend'));
    assert.match(sent(s.calls).at(-1)[1].text, /no raid running/);
    await s.r.onCommand(cmd('/raidtop', 55));
    assert.match(sent(s.calls).at(-1)[1].text, /1\. @ana · 1 raid/);
});

test('desde el bot de Telegram: el comando del grupo y el botón llegan al raid', async () => {
    const calls = [];
    const fetchImpl = async (url, o) => {
        if (url.includes('fxtwitter')) return { json: async () => ({ tweet: { likes: 0, retweets: 0 } }) };
        const method = url.split('/').pop(); calls.push([method, JSON.parse(o.body)]);
        return { json: async () => ({ ok: true, result: method === 'sendMessage' ? { message_id: 42 } : true }) };
    };
    const t = createTelegram({ token: 'x', stateFile: path.join(os.tmpdir(), 'tg-raid-' + process.pid + '.json'), fetchImpl });
    await t.onUpdate({ message: { message_id: 1, chat: { id: GROUP }, from: { id: ADMIN, is_bot: false }, text: '/raid ' + URL1 } });
    assert.equal(calls[0][0], 'sendMessage');
    assert.equal(calls[0][1].chat_id, GROUP);
    await t.onUpdate({ callback_query: { id: 'q', data: 'raid:done:2106221216373817434', from: { id: 7, username: 'bob' } } });
    assert.equal(calls.at(-1)[0], 'answerCallbackQuery');
    // un mensaje normal del grupo sigue su camino de siempre (sin raid)
    const n = calls.length;
    await t.onUpdate({ message: { message_id: 2, chat: { id: GROUP }, from: { id: 9, is_bot: false }, text: 'hola' } });
    assert.equal(calls.length, n);
});

test('el admin lanza el raid por privado: se publica en el grupo y le confirma a él', async () => {
    const s = setup();
    const dm = { message_id: 3, chat: { id: ADMIN, type: 'private' }, from: { id: ADMIN }, text: '/raid ' + URL1 + ' 5 2 10' };
    assert.equal(await s.r.onCommand(dm), true);
    const out = sent(s.calls);
    assert.equal(out[0][1].chat_id, GROUP);
    assert.match(out[0][1].text, /RAID!/);
    assert.equal(out[1][1].chat_id, ADMIN);
    assert.match(out[1][1].text, /started in the group/);
    await s.r.onCommand({ ...dm, text: '/raid nada' });
    assert.equal(sent(s.calls).at(-1)[1].chat_id, ADMIN);
    assert.equal(sent(s.calls).at(-1)[1].reply_parameters, undefined);
});

test('el usuario del admin cuenta como raider pero nunca se enseña ni sale en el ranking', async () => {
    const s = setup();
    await s.r.onCommand(cmd('/raid ' + URL1 + ' 5 3'));
    await s.r.onCallback({ id: 'qa', data: 'raid:done:2106221216373817434', from: { id: ADMIN, username: 'tarvuu' } });
    await s.r.onCallback(click(1, 'ana'));
    s.c.likes = 5; s.c.retweets = 3; await s.r.tick();
    const e = sent(s.calls).at(-1)[1].text;
    assert.doesNotMatch(e, /Raiders|@ana|tarvuu/);
    assert.equal(s.state.raid.points[ADMIN], undefined);
});
