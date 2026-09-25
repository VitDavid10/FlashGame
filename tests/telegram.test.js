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

test('soporte por privado: el mensaje llega al admin y su respuesta vuelve a la persona', async () => {
    const calls = []; let next = 500;
    const fetchImpl = async (url, o) => {
        const method = url.split('/').pop(), body = JSON.parse(o.body);
        calls.push([method, body]);
        return { json: async () => ({ ok: true, result: /sendMessage|copyMessage/.test(method) ? { message_id: next++ } : true }) };
    };
    const t = createTelegram({ token: 'x', stateFile: stateFile(), fetchImpl, admin: 1 });
    await t.onUpdate({ message: { message_id: 7, chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Ana', username: 'ana' }, text: 'my wallet does not connect' } });
    // Acuse de recibo a Ana (500), cabecera al admin (501), copia de su mensaje (502) y lo que le dijo el bot (503).
    assert.deepEqual(calls.filter(c => c[0] !== 'setMessageReaction').map(c => [c[0], c[1].chat_id]), [['sendMessage', 42], ['sendMessage', 1], ['copyMessage', 1], ['sendMessage', 1]]);
    calls.length = 0;
    // El admin responde a la copia (id 502): el bot se lo copia a Ana.
    await t.onUpdate({ message: { message_id: 9, chat: { id: 1, type: 'private' }, from: { id: 1 }, text: 'hello!', reply_to_message: { message_id: 502 } } });
    assert.deepEqual(calls[0], ['copyMessage', { chat_id: 42, from_chat_id: 1, message_id: 9 }]);
    calls.length = 0;
    // Sin responder a nada: no se manda a nadie, solo el aviso al admin.
    await t.onUpdate({ message: { message_id: 10, chat: { id: 1, type: 'private' }, from: { id: 1 }, text: 'x' } });
    assert.deepEqual(calls.map(c => [c[0], c[1].chat_id]), [['sendMessage', 1]]);
});

test('respuestas automáticas: contesta lo típico una vez por tema y avisa al admin', async () => {
    const calls = []; let next = 700;
    const fetchImpl = async (url, o) => {
        const method = url.split('/').pop(), body = JSON.parse(o.body);
        calls.push([method, body]);
        return { json: async () => ({ ok: true, result: /sendMessage|copyMessage/.test(method) ? { message_id: next++ } : true }) };
    };
    const t = createTelegram({ token: 'x', stateFile: stateFile(), fetchImpl, admin: 1 });
    const msg = text => ({ message: { message_id: 1, chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Nyx' }, text } });
    const toUser = () => calls.filter(c => c[0] === 'sendMessage' && c[1].chat_id === 42).map(c => c[1].text);

    await t.onUpdate(msg('Gm Sir'));                     // saludo: solo el acuse de recibo
    assert.deepEqual(toUser(), ['Got it! 🙌 The team will get back to you here soon.']);
    assert.ok(calls.some(c => c[0] === 'sendMessage' && c[1].chat_id === 1 && /The bot already answered:\s+Got it!/.test(c[1].text)));

    calls.length = 0;
    await t.onUpdate(msg('We offer marketing and KOL calls for your project'));
    assert.match(toUser()[0], /paid promotions/);

    calls.length = 0;
    await t.onUpdate(msg('can you do a collab?'));      // mismo tema en menos de 24 h: no repite
    assert.deepEqual(toUser(), []);

    calls.length = 0;
    await t.onUpdate(msg("what's the CA?"));
    assert.match(toUser()[0], /isn't live yet/);

    calls.length = 0;
    await t.onUpdate(msg('I can help you'));             // "can" no es "ca"; el acuse ya se mandó hoy
    assert.deepEqual(toUser(), []);
});

test('respuestas automáticas: enlaces oficiales y airdrop sin enlace a la web', async () => {
    const calls = [];
    const fetchImpl = async (url, o) => { calls.push([url.split('/').pop(), JSON.parse(o.body)]); return { json: async () => ({ ok: true, result: { message_id: 1 } }) }; };
    const t = createTelegram({ token: 'x', stateFile: stateFile(), fetchImpl, admin: 1 });
    const say = async text => { calls.length = 0; await t.onUpdate({ message: { message_id: 1, chat: { id: 42, type: 'private' }, from: { id: 42 }, text } }); return (calls.find(c => c[0] === 'sendMessage' && c[1].chat_id === 42) || [])[1]; };
    assert.match((await say("what's your discord?")).text, /discord\.gg\/rfZK7fQ32E/);
    const air = (await say('how do I get airdrop points?')).text;
    assert.match(air, /Stay tuned/);
    assert.doesNotMatch(air, /pillwars\.fun/);
});

test('chat del admin sin ruido: lo resuelto no llega y la cabecera no se repite', async () => {
    const calls = []; let next = 900;
    const fetchImpl = async (url, o) => { calls.push([url.split('/').pop(), JSON.parse(o.body)]); return { json: async () => ({ ok: true, result: { message_id: next++ } }) }; };
    const t = createTelegram({ token: 'x', stateFile: stateFile(), fetchImpl, admin: 1 });
    const say = text => t.onUpdate({ message: { message_id: 1, chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Nyx' }, text } });
    const toAdmin = () => calls.filter(c => c[1].chat_id === 1 && c[0] !== 'setMessageReaction').map(c => c[0]);
    await say("what's the CA?");                       // resuelto por el bot: nada al admin
    assert.deepEqual(toAdmin(), []);
    calls.length = 0;
    await say('I have a question');                    // empieza conversación: cabecera + copia + lo que contestó el bot
    assert.deepEqual(toAdmin(), ['sendMessage', 'copyMessage', 'sendMessage']);
    calls.length = 0;
    await say('about my wallet');                      // seguido: solo la copia
    assert.deepEqual(toAdmin(), ['copyMessage']);
});

test('grupo: si varios piden el CA, el bot contesta solo al primero (10 min por tema)', async () => {
    const calls = [];
    const fetchImpl = async (url, o) => { calls.push([url.split('/').pop(), JSON.parse(o.body)]); return { json: async () => ({ ok: true, result: { message_id: 1 } }) }; };
    const t = createTelegram({ token: 'x', stateFile: stateFile(), fetchImpl, admin: 1 });
    const ask = (id, text, extra = {}) => t.onUpdate({ message: { message_id: id, chat: { id: -1004327296311 }, from: { id: 100 + id, is_bot: false }, text, ...extra } });
    await ask(1, 'ca?');
    await ask(2, 'whats the CA');
    await ask(3, 'contract address pls');
    await ask(4, 'send the discord link');
    await ask(5, 'hello everyone');
    await ask(6, 'ca', { sender_chat: { id: -1004327296311 } });   // admin anónimo: no se le contesta
    assert.deepEqual(calls.map(c => [c[0], c[1].reply_parameters.message_id]), [['sendMessage', 1], ['sendMessage', 4]]);
});

test('en mitad de una conversación llega todo, y cada mensaje cuelga de la cabecera de su autor', async () => {
    const calls = []; let next = 1000;
    const fetchImpl = async (url, o) => { calls.push([url.split('/').pop(), JSON.parse(o.body)]); return { json: async () => ({ ok: true, result: { message_id: next++ } }) }; };
    const t = createTelegram({ token: 'x', stateFile: stateFile(), fetchImpl, admin: 1 });
    const from = (id, text) => t.onUpdate({ message: { message_id: 1, chat: { id, type: 'private' }, from: { id, first_name: 'U' + id }, text } });
    await from(42, 'hello');                              // ack a 42 (1000), cabecera (1001), copia (1002)
    await from(43, 'gm');                                 // ack a 43 (1003), cabecera (1004), copia (1005)
    calls.length = 0;
    await from(42, 'what are your links?');               // ya hablando: le llega al admin aunque sea un tema resuelto
    const copy = calls.find(c => c[0] === 'copyMessage');
    assert.equal(copy[1].reply_parameters.message_id, 1001);   // cuelga de la cabecera de 42, no de la de 43
});

test('pendientes: 👀 al llegar, 👌 al contestar y /pending lista quién espera', async () => {
    const calls = []; let next = 2000;
    const fetchImpl = async (url, o) => { calls.push([url.split('/').pop(), JSON.parse(o.body)]); return { json: async () => ({ ok: true, result: { message_id: next++ } }) }; };
    const t = createTelegram({ token: 'x', stateFile: stateFile(), fetchImpl, admin: 1 });
    const user = (id, text) => t.onUpdate({ message: { message_id: 1, chat: { id, type: 'private' }, from: { id, first_name: 'U' + id }, text } });
    const admin = (text, reply) => t.onUpdate({ message: { message_id: 50, chat: { id: 1, type: 'private' }, from: { id: 1 }, text, ...(reply ? { reply_to_message: { message_id: reply } } : {}) } });
    const reacts = () => calls.filter(c => c[0] === 'setMessageReaction').map(c => [c[1].message_id, c[1].reaction[0].emoji]);

    await user(42, 'hello');          // ack 2000, cabecera 2001, copia 2002 → 👀, nota del bot 2003
    await user(43, 'hey');            // (la reacción de 42 gasta el 2004) ack 2005, cabecera 2006, copia 2007 → 👀
    assert.deepEqual(reacts(), [[2002, '👀'], [2007, '👀']]);

    calls.length = 0;
    await admin('/pending');
    const lines = calls.filter(c => c[0] === 'sendMessage').map(c => c[1].text);
    assert.equal(lines.length, 3);
    assert.match(lines[1], /U42/); assert.match(lines[2], /U43/);

    calls.length = 0;
    await admin('hi there', 2002);    // contesta a 42 → su mensaje pasa a 👌
    assert.deepEqual(reacts().filter(r => r[0] === 2002), [[2002, '👌']]);

    calls.length = 0;
    await admin('/pending');
    const after = calls.filter(c => c[0] === 'sendMessage').map(c => c[1].text);
    assert.equal(after.length, 2);
    assert.match(after[1], /U43/);
});
