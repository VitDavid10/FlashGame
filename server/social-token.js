'use strict';
/*
 * Ficha de identidad para el servicio social (amigos, grupos, susurros).
 *
 * El proceso que guarda las cuentas del airdrop (mono o Director) la firma con
 * HMAC; el host que aloja las arenas (donde viven los grupos) solo la verifica.
 * El secreto lo genera el proceso padre y los hosts lo heredan por el entorno al
 * hacer fork, asi que no viaja ni se guarda en ningun fichero.
 *
 * Lleva el codigo publico de invitacion de la cuenta (no el uid interno), el
 * usuario de X y su foto: lo justo para que los demas vean quien eres.
 */
const crypto = require('crypto');

const TTL_MS = 12 * 3600 * 1000;
const b64 = s => Buffer.from(s).toString('base64url');

function secret() {
    if (!process.env.PW_SOCIAL_SECRET) process.env.PW_SOCIAL_SECRET = crypto.randomBytes(32).toString('hex');
    return process.env.PW_SOCIAL_SECRET;
}
function mac(body) { return crypto.createHmac('sha256', secret()).update(body).digest('base64url'); }

/** p = { id, u (usuario de X), n (nombre), p (url foto) } */
// Solo fotos de X: una URL cualquiera la descargarian los navegadores de todos los amigos (fuga de IP).
const PIC_OK = /^https:\/\/pbs\.twimg\.com\/[\w\-\/.]+$/;
function sign(p, now = Date.now()) {
    const pic = PIC_OK.test(String(p.p || '')) ? String(p.p).slice(0, 300) : '';
    const body = b64(JSON.stringify({ id: String(p.id), u: String(p.u || '').replace(/[^\w]/g, '').slice(0, 20), n: String(p.n || '').replace(/[\x00-\x1f<>]/g, '').slice(0, 40), p: pic, exp: now + TTL_MS }));
    return body + '.' + mac(body);
}
/** Devuelve el perfil o null si la firma no cuadra o caduco. */
function verify(token, now = Date.now()) {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const ok = mac(body);
    if (sig.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(ok))) return null;
    let o; try { o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
    if (!o || !o.id || !(o.exp > now)) return null;
    return { id: o.id, u: o.u, n: o.n, p: o.p };
}

module.exports = { sign, verify, secret };
