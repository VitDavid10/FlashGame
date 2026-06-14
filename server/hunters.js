/*
 * Cazadores: N jugadores online con IA táctica que van a por el jugador real.
 *
 * - Se conectan como jugadores normales (cuentan para el lobby).
 * - Objetivo: el jugador que NO sea un cazador. Si son más grandes, lo persiguen
 *   (con split-attack a tiro); si son más pequeños, huyen y engordan con bots.
 * - Esquivan virus cuando les harían daño y se reparten para no chocarse.
 * - Si mueren, reentran solos a los 3 segundos.
 *
 * Uso: node server/hunters.js [n] [sala] [modo]   (def: 4 Free classic)
 *      SERVER=wss://... para ir por túnel; def ws://localhost:8080
 */
'use strict';

const WebSocket = require('ws');

const N = parseInt(process.argv[2], 10) || 4;
const ROOM = process.argv[3] || 'Free';
const MODE = process.argv[4] || 'classic';
const URL = process.env.SERVER || 'ws://localhost:8080';

const hunterIds = new Set();          // ids de todos los cazadores (compartido)
const COLORS = ['#ff8800', '#b07cf7', '#1a73e8', '#ff2a2a', '#00c2a8', '#ffce3d'];

function massOf(cells) { return cells.reduce((s, c) => s + c.r * c.r, 0); }
function centroid(cells) {
    let x = 0, y = 0, w = 0;
    for (const c of cells) { const m = c.r * c.r; x += c.x * m; y += c.y * m; w += m; }
    return w ? { x: x / w, y: y / w } : null;
}

class Hunter {
    constructor(i) {
        this.name = 'CLAUDE-' + (i + 1);
        this.color = COLORS[i % COLORS.length];
        this.id = null;
        this.snap = null;
        this.mapSize = 7000;
        this.lastSplit = 0;
        this.wander = { x: 0, y: 0, until: 0 };
        this.connect();
    }

    connect() {
        const ws = this.ws = new WebSocket(URL);
        ws.on('open', () => ws.send(JSON.stringify({
            t: 'join', room: ROOM, mode: MODE, name: this.name,
            colorBot: this.color, colorTop: '#16181c', config: {}
        })));
        ws.on('message', raw => {
            let m; try { m = JSON.parse(raw); } catch (e) { return; }
            if (m.t === 'welcome' || m.t === 'matchStart') {
                this.id = m.id; this.mapSize = m.mapSize || 7000;
                hunterIds.add(m.id);
                console.log(`[${this.name}] dentro (${m.t}) id=${this.id}`);
            } else if (m.t === 'snap') {
                this.snap = m;
            } else if (m.t === 'roomRestart' || m.t === 'kicked') {
                console.log(`[${this.name}] sala reiniciada/expulsado — reentrando en 3s`);
                try { ws.close(); } catch (e) {}
            }
        });
        ws.on('close', () => setTimeout(() => this.connect(), 3000));
        ws.on('error', () => {});
    }

    me() { return this.snap && this.snap.players.find(p => p.id === this.id); }

    think() {
        if (!this.snap || this.ws.readyState !== 1) return;
        const yo = this.me();
        if (!yo) return;
        if (!yo.alive || yo.cells.length === 0) {
            // muerto: reentrar como jugador nuevo
            if (!this.rejoining) {
                this.rejoining = true;
                console.log(`[${this.name}] me han matado — TRY AGAIN en 3s`);
                try { this.ws.close(); } catch (e) {}
                setTimeout(() => { this.rejoining = false; }, 100);
            }
            return;
        }
        const pos = centroid(yo.cells);
        const myMass = massOf(yo.cells);
        const myMaxR = Math.max(...yo.cells.map(c => c.r));
        const now = Date.now();

        // Presa: el jugador real (no cazador) vivo
        const presa = this.snap.players.find(p => !hunterIds.has(p.id) && p.alive && p.cells.length > 0);
        const presaPos = presa ? centroid(presa.cells) : null;
        const presaMaxR = presa ? Math.max(...presa.cells.map(c => c.r)) : 0;
        const presaMass = presa ? massOf(presa.cells) : 0;

        let dx = 0, dy = 0;

        // 1) Amenazas: celdas (presa o bots) que pueden comer mi celda grande
        const amenazas = [];
        if (presa) for (const c of presa.cells) if (c.r > myMaxR * 1.15) amenazas.push(c);
        for (const b of this.snap.bots) if (b.r > myMaxR * 1.15) amenazas.push(b);
        for (const a of amenazas) {
            const d = Math.hypot(pos.x - a.x, pos.y - a.y) || 1;
            if (d < a.r * 4 + 400) { const f = 1200 / d; dx += (pos.x - a.x) / d * f; dy += (pos.y - a.y) / d * f; }
        }

        // ¿Algún cazador ya es más grande que la presa? Entonces TODOS acosan en jauría
        let jauriaManda = false;
        if (presa) {
            for (const otro of hunters) {
                const op = otro.me && otro.me();
                if (op && op.alive && massOf(op.cells) > presaMass * 1.2) { jauriaManda = true; break; }
            }
        }

        // 2) Caza: voy a por él si le saco ventaja, O si la jauría manda (presiono aunque
        //    sea pequeño: le quito espacio y lo empujo hacia el cazador grande)
        const peligroso = amenazas.length > 0 && Math.hypot(pos.x - amenazas[0].x, pos.y - amenazas[0].y) < 600;
        const puedoComerlo = myMass > presaMass * 1.25;
        if (presa && (puedoComerlo || jauriaManda) && !(peligroso && !puedoComerlo)) {
            const d = Math.hypot(presaPos.x - pos.x, presaPos.y - pos.y) || 1;
            const empuje = puedoComerlo ? 2.6 : 1.6;   // si no puedo comerlo, acoso sin suicidarme
            dx += (presaPos.x - pos.x) / d * empuje; dy += (presaPos.y - pos.y) / d * empuje;
            // split-attack si está a tiro, le saco radio y no estoy ya muy partido
            if (puedoComerlo && d < myMaxR * 5.5 && myMaxR > presaMaxR * 1.5 && yo.cells.length < 4 && now - this.lastSplit > 3500) {
                this.lastSplit = now;
                this.ws.send(JSON.stringify({ t: 'action', kind: 'split', tx: presaPos.x, ty: presaPos.y }));
            }
        } else {
            // 3) Engordar: bot más cercano que pueda comerme
            let mejor = null, mejorD = 1e9;
            for (const b of this.snap.bots) {
                if (myMaxR > b.r * 1.3) {
                    const d = Math.hypot(b.x - pos.x, b.y - pos.y);
                    if (d < mejorD) { mejorD = d; mejor = b; }
                }
            }
            if (mejor && mejorD < 2500) { dx += (mejor.x - pos.x) / mejorD * 1.5; dy += (mejor.y - pos.y) / mejorD * 1.5; }
            else {
                // pasear hacia un punto aleatorio (sesgado hacia la presa para acecharla)
                if (now > this.wander.until) {
                    const base = presaPos || { x: 0, y: 0 };
                    const lim = this.mapSize / 2 * 0.85;
                    this.wander = {
                        x: Math.max(-lim, Math.min(lim, base.x + (Math.random() - 0.5) * 3000)),
                        y: Math.max(-lim, Math.min(lim, base.y + (Math.random() - 0.5) * 3000)),
                        until: now + 4000
                    };
                }
                const d = Math.hypot(this.wander.x - pos.x, this.wander.y - pos.y) || 1;
                dx += (this.wander.x - pos.x) / d; dy += (this.wander.y - pos.y) / d;
            }
        }

        // 4) Virus: esquivar si me harían explotar (soy más grande que el virus)
        for (const v of this.snap.viruses) {
            if (myMaxR > v.r * 1.1) {
                const d = Math.hypot(pos.x - v.x, pos.y - v.y) || 1;
                if (d < v.r + myMaxR + 220) { const f = 900 / d; dx += (pos.x - v.x) / d * f; dy += (pos.y - v.y) / d * f; }
            }
        }

        // 5) No amontonarse con otros cazadores
        for (const otro of hunters) {
            if (otro === this || !otro.snap) continue;
            const op = otro.me && otro.me(); if (!op || !op.cells.length) continue;
            const oc = centroid(op.cells);
            const d = Math.hypot(pos.x - oc.x, pos.y - oc.y) || 1;
            if (d < 500) { dx += (pos.x - oc.x) / d * 0.8; dy += (pos.y - oc.y) / d * 0.8; }
        }

        const len = Math.hypot(dx, dy) || 1;
        this.ws.send(JSON.stringify({ t: 'input', tx: pos.x + dx / len * 600, ty: pos.y + dy / len * 600 }));
    }
}

const hunters = [];
for (let i = 0; i < N; i++) setTimeout(() => hunters.push(new Hunter(i)), i * 350);
setInterval(() => { for (const h of hunters) { try { h.think(); } catch (e) {} } }, 50);
console.log(`${N} cazadores conectándose a ${URL} (sala ${ROOM}, modo ${MODE})...`);
