/*
 * PillWars — protocolo binario de snapshots.
 *
 * Solo el mensaje SNAP va en binario; events/welcome/etc. siguen JSON.
 * Activación: el cliente pide opt-in con {t:'join', bin:1}; si el servidor
 * lo acepta el welcome lleva useBin:true y los snaps llegan como ArrayBuffer.
 *
 * Formato (little-endian, DataView):
 *   u8  ver = 1
 *   u32 time
 *   i32 tl                 (-1 = null)
 *   u32 pot
 *   u16 alv                (alive global autoritativo)
 *   u16 nPlayers
 *     per player: idStr, nameStr, u8 ks, u8 flags (bit0 alive), u16 gcd,
 *       u8 nSlots [u8 id, u8 uses]*,
 *       u8 nSs    [u8 i, u16 ms]*,
 *       u16 nCells [cellBin]*
 *   u16 nBots
 *     per bot: cellBin, idStr, nameStr
 *   u16 nViruses
 *     per virus: u32 ci, i16 x, i16 y, u16 r10, u8 d, u16 a
 *   u16 nEjected
 *     per: u32 ci, i16 x, i16 y, u8 r, 3B c1, 3B c2, i16 angle*1000
 *   u16 nProjectiles
 *     per: u32 ci, i16 x, i16 y, u8 r
 *
 *   str = u8 len, bytes (utf8)
 *   cellBin (≥17B):
 *     u32 ci, i16 x, i16 y, u16 r10,
 *     3B cb, 3B ct, u8 flags (bit0=skin, bit1=im, bit2=sp, bit3=mg, bit4=tp)
 *     [u8 skinLen, bytes]?  [u16 immune]?  [u8 phase, u16 tt]?
 *
 * Coordenadas como i16 (±32767) — el mapa nunca pasa de 8000.
 * Radio como u16 con escala ×10 → resolución 0.1 px, hasta 6553 px.
 */
'use strict';

const VER = 2;
const FLAG_SKIN = 1, FLAG_IM = 2, FLAG_SP = 4, FLAG_MG = 8, FLAG_TP = 16;
const FLAG_ALIVE = 1;

// Buffer escritor que crece on-demand. WebSocket acepta Uint8Array.
class Writer {
    constructor(initial = 4096) {
        this.buf = new Uint8Array(initial);
        this.view = new DataView(this.buf.buffer);
        this.pos = 0;
    }
    _grow(extra) {
        if (this.pos + extra <= this.buf.length) return;
        let nlen = this.buf.length;
        while (nlen < this.pos + extra) nlen *= 2;
        const nbuf = new Uint8Array(nlen);
        nbuf.set(this.buf);
        this.buf = nbuf;
        this.view = new DataView(nbuf.buffer);
    }
    u8(v) { this._grow(1); this.view.setUint8(this.pos, v); this.pos += 1; }
    u16(v) { this._grow(2); this.view.setUint16(this.pos, v, true); this.pos += 2; }
    u32(v) { this._grow(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
    i16(v) { this._grow(2); this.view.setInt16(this.pos, Math.max(-32768, Math.min(32767, v | 0)), true); this.pos += 2; }
    i32(v) { this._grow(4); this.view.setInt32(this.pos, v | 0, true); this.pos += 4; }
    str(s) {
        s = s == null ? '' : String(s);
        // Truncamos a 255 bytes (utf8). El servidor ya limita name a 16; para
        // ids/UUIDs basta ASCII y son 36 bytes; skinUrl es data: largo.
        let bytes;
        if (typeof TextEncoder !== 'undefined') bytes = new TextEncoder().encode(s);
        else { bytes = []; for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff); bytes = Uint8Array.from(bytes); }
        let len = bytes.length;
        if (len > 65535) { bytes = bytes.subarray(0, 65535); len = 65535; }
        // Usamos u16 para soportar skinUrl largos (data:image…).
        this.u16(len);
        this._grow(len);
        this.buf.set(bytes, this.pos);
        this.pos += len;
    }
    out() { return this.buf.subarray(0, this.pos); }
}

class Reader {
    constructor(arrayBuffer) {
        this.buf = new Uint8Array(arrayBuffer);
        this.view = new DataView(arrayBuffer);
        this.pos = 0;
    }
    u8() { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
    u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
    u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
    i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
    i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
    str() {
        const len = this.u16();
        const bytes = this.buf.subarray(this.pos, this.pos + len);
        this.pos += len;
        if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
        let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s;
    }
}

// "#rrggbb" → [r,g,b]. Fallback a (255,255,255) si no parsea.
function hex3(s) {
    if (typeof s === 'string' && s.length >= 7 && s.charCodeAt(0) === 35) {
        const r = parseInt(s.substr(1, 2), 16);
        const g = parseInt(s.substr(3, 2), 16);
        const b = parseInt(s.substr(5, 2), 16);
        if (!isNaN(r)) return [r, g, b];
    }
    return [255, 255, 255];
}
function toHex(r, g, b) {
    const h = n => (n & 0xff).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
}

// --- Encode/decode de una "cell" (jugador o bot) ---
function writeCell(w, c) {
    w.u32(c.ci >>> 0);
    w.i16(Math.round(c.x));
    w.i16(Math.round(c.y));
    w.u16(Math.max(0, Math.min(65535, Math.round(c.r * 10))));
    const cb = hex3(c.cb), ct = hex3(c.ct);
    w.u8(cb[0]); w.u8(cb[1]); w.u8(cb[2]);
    w.u8(ct[0]); w.u8(ct[1]); w.u8(ct[2]);
    let flags = 0;
    if (c.sk) flags |= FLAG_SKIN;
    if (c.im) flags |= FLAG_IM;
    if (c.sp) flags |= FLAG_SP;
    if (c.mg) flags |= FLAG_MG;
    if (c.tp) flags |= FLAG_TP;
    w.u8(flags);
    if (flags & FLAG_SKIN) w.str(c.sk);
    if (flags & FLAG_IM)   w.u16(Math.min(65535, c.im | 0));
    if (flags & FLAG_TP)   { w.u8(c.tp | 0); w.u16(Math.min(65535, c.tt | 0)); }
}
function readCell(r) {
    const o = {};
    o.ci = r.u32();
    o.x = r.i16();
    o.y = r.i16();
    o.r = r.u16() / 10;
    const cbr = r.u8(), cbg = r.u8(), cbb = r.u8();
    const ctr = r.u8(), ctg = r.u8(), ctb = r.u8();
    o.cb = toHex(cbr, cbg, cbb);
    o.ct = toHex(ctr, ctg, ctb);
    const flags = r.u8();
    if (flags & FLAG_SKIN) o.sk = r.str();
    if (flags & FLAG_IM)   o.im = r.u16();
    if (flags & FLAG_SP) o.sp = 1;
    if (flags & FLAG_MG) o.mg = 1;
    if (flags & FLAG_TP) { o.tp = r.u8(); o.tt = r.u16(); }
    return o;
}

function encodeSnap(snap) {
    const w = new Writer();
    w.u8(VER);
    w.u32(snap.time >>> 0);
    w.i32(snap.tl == null ? -1 : (snap.tl | 0));
    w.u32(snap.pot | 0);
    w.u16(Math.min(65535, snap.alv | 0));   // alive global (autoritativo, no AOI)
    // Players
    w.u16(snap.players.length);
    for (const p of snap.players) {
        w.str(p.id);
        w.str(p.name || '');
        w.u8(Math.max(0, Math.min(255, p.ks | 0)));
        w.u8(p.alive ? FLAG_ALIVE : 0);
        w.u16(Math.max(0, Math.min(65535, p.gcd | 0)));
        const slots = p.slots || [];
        w.u8(Math.min(255, slots.length));
        for (const s of slots) {
            if (s && s.id) { w.u8(s.id & 0xff); w.u8(Math.min(255, s.u | 0)); }
            else { w.u8(0); w.u8(0); }
        }
        const ss = p.ss || {};
        const ssKeys = Object.keys(ss).slice(0, 255);
        w.u8(ssKeys.length);
        for (const k of ssKeys) { w.u8(parseInt(k, 10) & 0xff); w.u16(Math.min(65535, ss[k] | 0)); }
        w.u16(Math.min(65535, p.cells.length));
        for (const c of p.cells) writeCell(w, c);
    }
    // Bots
    w.u16(snap.bots.length);
    for (const b of snap.bots) {
        writeCell(w, b);
        w.str(b.id);
        w.str(b.n || '');
    }
    // Viruses
    w.u16(snap.viruses.length);
    for (const v of snap.viruses) {
        w.u32(v.ci >>> 0);
        w.i16(Math.round(v.x));
        w.i16(Math.round(v.y));
        w.u16(Math.max(0, Math.min(65535, Math.round(v.r * 10))));
        w.u8(v.d ? 1 : 0);
        w.u16(Math.max(0, Math.min(65535, Math.round((v.a || 0) * 10))));
    }
    // Ejected
    w.u16(snap.ejected.length);
    for (const e of snap.ejected) {
        w.u32(e.ci >>> 0);
        w.i16(Math.round(e.x));
        w.i16(Math.round(e.y));
        w.u8(Math.max(0, Math.min(255, Math.round(e.r))));
        const c1 = hex3(e.c1), c2 = hex3(e.c2);
        w.u8(c1[0]); w.u8(c1[1]); w.u8(c1[2]);
        w.u8(c2[0]); w.u8(c2[1]); w.u8(c2[2]);
        w.i16(Math.round((e.a || 0) * 1000));
    }
    // Projectiles
    w.u16(snap.projectiles.length);
    for (const pr of snap.projectiles) {
        w.u32(pr.ci >>> 0);
        w.i16(Math.round(pr.x));
        w.i16(Math.round(pr.y));
        w.u8(Math.max(0, Math.min(255, Math.round(pr.r))));
    }
    return w.out();
}

function decodeSnap(arrayBuffer) {
    const r = new Reader(arrayBuffer);
    const ver = r.u8();
    if (ver !== VER) throw new Error('proto: versión ' + ver + ' no soportada');
    const snap = { t: 'snap' };
    snap.time = r.u32();
    const tl = r.i32(); snap.tl = (tl < 0) ? null : tl;
    snap.pot = r.u32();
    snap.alv = r.u16();
    const nPlayers = r.u16();
    snap.players = [];
    for (let i = 0; i < nPlayers; i++) {
        const p = {};
        p.id = r.str();
        p.name = r.str();
        p.ks = r.u8();
        const flags = r.u8();
        p.alive = !!(flags & FLAG_ALIVE);
        p.gcd = r.u16();
        const nSlots = r.u8();
        p.slots = [];
        for (let j = 0; j < nSlots; j++) {
            const sid = r.u8(), su = r.u8();
            p.slots.push(sid === 0 ? 0 : { id: sid, u: su });
        }
        const nSs = r.u8();
        p.ss = {};
        for (let j = 0; j < nSs; j++) { const k = r.u8(); p.ss[k] = r.u16(); }
        const nCells = r.u16();
        p.cells = [];
        for (let j = 0; j < nCells; j++) p.cells.push(readCell(r));
        snap.players.push(p);
    }
    const nBots = r.u16();
    snap.bots = [];
    for (let i = 0; i < nBots; i++) {
        const b = readCell(r);
        b.id = r.str();
        b.n = r.str();
        snap.bots.push(b);
    }
    const nViruses = r.u16();
    snap.viruses = [];
    for (let i = 0; i < nViruses; i++) {
        snap.viruses.push({
            ci: r.u32(), x: r.i16(), y: r.i16(),
            r: r.u16() / 10,
            d: r.u8(),
            a: r.u16() / 10
        });
    }
    const nEjected = r.u16();
    snap.ejected = [];
    for (let i = 0; i < nEjected; i++) {
        const ci = r.u32(), x = r.i16(), y = r.i16(), rr = r.u8();
        const c1 = toHex(r.u8(), r.u8(), r.u8());
        const c2 = toHex(r.u8(), r.u8(), r.u8());
        const a = r.i16() / 1000;
        snap.ejected.push({ ci, x, y, r: rr, c1, c2, a });
    }
    const nProj = r.u16();
    snap.projectiles = [];
    for (let i = 0; i < nProj; i++) {
        snap.projectiles.push({ ci: r.u32(), x: r.i16(), y: r.i16(), r: r.u8() });
    }
    return snap;
}

const api = { encodeSnap, decodeSnap, VER };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.PillProto = api;
