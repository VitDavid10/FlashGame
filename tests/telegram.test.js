'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { createTelegram } = require('../server/telegram.js');

function fake(tweets) {
    const calls = [];
    const fetchImpl = async (url, o) => {
        if (url.includes('fxtwitter')) return { json: async () => ({ results: tweets }) };
        const method = url.split('/').pop(), body = JSON.parse(o.body);
        calls.push([method, body]);
        return { json: async () => ({ ok: true, result: method === 'sendMessage' ? { message_id: 99 } : true }) };
    };
    return { calls, fetchImpl };
}
const tw = (id, extra = {}) => ({ id, text: 't' + id, url: 'https://x.com/pillwarsdotfun/status/' + id, author: { screen_name: 'pillwarsdotfun' }, replying_to: null, ...extra });
const stateFile = () => path.join(os.tmpdir(), 'tg-state-' + process.pid + '-' + Math.random() + '.json');

test('post del canal se fija; el aviso de "pinned" se borra', async () => {
    const f = fake([]);
    const t = createTelegram({ token: 'x', stateFile: stateFile(), fetchImpl: f.fetchImpl });
    await t.onUpdate({ channel_post: { message_id: 5, chat: { id: -1004433617369 } } });
    await t.onUpdate({ channel_post: { message_id: 6, chat: { id: -1004433617369 }, pinned_message: {} } });
    await t.onUpdate({ channel_post: { message_id: 7, chat: { id: -1004327296311 } } });
    assert.deepEqual(f.calls.map(c => [c[0], c[1].message_id]), [['pinChatMessage', 5], ['deleteMessage', 6]]);
});

test('en el grupo se fija el anuncio reenviado, no lo que escribe la gente', async () => {
    const f = fake([]);
    const t = createTelegram({ token: 'x', stateFile: stateFile(), fetchImpl: f.fetchImpl });
    await t.onUpdate({ message: { message_id: 10, chat: { id: -1004327296311 }, is_automatic_forward: true } });
    await t.onUpdate({ message: { message_id: 11, chat: { id: -1004327296311 }, from: { is_bot: false }, text: 'hola' } });
    await t.onUpdate({ message: { message_id: 12, chat: { id: -1004327296311 }, sender_chat: { id: -1004433617369 }, pinned_message: {} } });
    assert.deepEqual(f.calls.map(c => [c[0], c[1].chat_id, c[1].message_id]), [['pinChatMessage', -1004327296311, 10], ['deleteMessage', -1004327296311, 12]]);
});

test('X: la primera vez no vuelca el historial; luego reenvía y fija solo posts nuevos propios', async () => {
    const file = stateFile();
    const f1 = fake([tw('100'), tw('90')]);
    await createTelegram({ token: 'x', stateFile: file, fetchImpl: f1.fetchImpl }).checkX();
    assert.equal(f1.calls.length, 0);

    const f2 = fake([tw('120'), tw('110', { replying_to: { screen_name: 'solana' } }), tw('105'), tw('100')]);
    const toDiscord = [];
    await createTelegram({ token: 'x', stateFile: file, fetchImpl: f2.fetchImpl, onXPost: async u => toDiscord.push(u) }).checkX();
    assert.deepEqual(toDiscord, ['https://fixupx.com/pillwarsdotfun/status/105', 'https://fixupx.com/pillwarsdotfun/status/120']);
    assert.deepEqual(f2.calls.map(c => c[0] + ':' + (c[1].text || c[1].message_id)), [
        'sendMessage:<b>New post on 𝕏</b>\n\nt105\n\nhttps://fixupx.com/pillwarsdotfun/status/105', 'pinChatMessage:99',
        'sendMessage:<b>New post on 𝕏</b>\n\nt120\n\nhttps://fixupx.com/pillwarsdotfun/status/120', 'pinChatMessage:99',
    ]);
});

test('sin TELEGRAM_BOT_TOKEN no arranca', () => {
    assert.equal(createTelegram({}).enabled, false);
});
