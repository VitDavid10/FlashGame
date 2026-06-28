#!/usr/bin/env node
/**
 * Panel local de stress test para PillWars.
 *
 * Sirve index.html en http://localhost:7777 y gestiona el spawn/stop de
 * stress-npc.js y stress-ddos.js como procesos hijos. Cada test emite líneas
 * "STATS {json}" que se reenvían vía Server-Sent Events al panel para que
 * actualice el HUD en vivo.
 *
 * Diseñado para correr en TU PC (no en el VPS): así el generador no compite
 * por CPU con el servidor de juego.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '7777', 10);

// Estado actual del test
const state = {
    proc: null,
    kind: null,          // 'npc' | 'ddos'
    params: null,
    stats: null,
    startedAt: 0,
    running: false,
    error: null,
};

// Suscriptores SSE para empujar stats al panel
const sseClients = new Set();
function sseBroadcast(obj) {
    const data = 'data: ' + JSON.stringify(obj) + '\n\n';
    for (const res of sseClients) { try { res.write(data); } catch (e) {} }
}

function pushState() {
    sseBroadcast({
        running: state.running,
        kind: state.kind,
        params: state.params,
        stats: state.stats,
        startedAt: state.startedAt,
        elapsed: state.running ? Math.round((Date.now() - state.startedAt) / 1000) : 0,
        error: state.error,
    });
}

function stopTest() {
    if (state.proc) { try { state.proc.kill('SIGTERM'); } catch (e) {} }
    state.proc = null; state.running = false;
}

function startTest(kind, script, env, params) {
    if (state.running) return { ok: false, reason: 'ya hay un test en marcha' };
    state.kind = kind; state.params = params;
    state.stats = null; state.error = null; state.startedAt = Date.now(); state.running = true;
    const proc = spawn(process.execPath, [path.join(__dirname, script)], {
        env: Object.assign({}, process.env, env, { STRESS_JSON: '1' }),
        cwd: __dirname,
    });
    state.proc = proc;
    let buf = '';
    proc.stdout.on('data', d => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            if (line.startsWith('STATS ')) {
                try { state.stats = JSON.parse(line.slice(6)); pushState(); } catch (e) {}
            }
        }
    });
    proc.stderr.on('data', d => { state.error = d.toString().slice(0, 300); pushState(); });
    proc.on('exit', () => { state.running = false; state.proc = null; pushState(); });
    proc.on('error', e => { state.error = e.message; state.running = false; state.proc = null; pushState(); });
    pushState();
    return { ok: true };
}

function startNpc(p) {
    const bots       = Math.max(1, Math.min(5000, p.bots | 0 || 300));
    const duration   = Math.max(0, Math.min(86400, p.duration | 0));
    const ramp       = Math.max(5, Math.min(2000, p.ramp | 0 || 60));
    const inputHz    = Math.max(1, Math.min(40, p.inputHz | 0 || 30));
    const rooms      = Array.isArray(p.rooms) ? p.rooms.filter(k => typeof k === 'string').slice(0, 40).join(',') : '';
    const respawn    = p.respawn !== false;
    const respawnMin = Math.max(0,    Math.min(60000, p.respawnMin | 0 || 2000));
    const respawnMax = Math.max(100,  Math.min(60000, p.respawnMax | 0 || 6000));
    const server     = String(p.server || 'ws://localhost:8080');
    const env = {
        SERVER: server, BOTS: String(bots), DURATION_S: String(duration), RAMP_MS: String(ramp),
        INPUT_HZ: String(inputHz), RESPAWN: respawn ? '1' : '0',
        RESPAWN_MIN_MS: String(respawnMin), RESPAWN_MAX_MS: String(respawnMax),
    };
    if (rooms) env.ROOMS = rooms;
    return startTest('npc', 'stress-npc.js', env,
        { bots, duration, ramp, inputHz, respawn, respawnMin, respawnMax, server, rooms: rooms ? rooms.split(',') : 'todas' });
}

function startDdos(p) {
    const rate     = Math.max(10, Math.min(100000, p.rate | 0 || 1000));
    const conns    = Math.max(1,  Math.min(500,   p.conns | 0 || 10));
    const duration = Math.max(1,  Math.min(600,   p.duration | 0 || 20));
    const server   = String(p.server || 'ws://localhost:8080');
    const env = { SERVER: server, RATE: String(rate), CONNS: String(conns), DURATION_S: String(duration) };
    return startTest('ddos', 'stress-ddos.js', env, { rate, conns, duration, server });
}

// --- HTTP ---
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));
const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(INDEX);
        return;
    }
    if (req.method === 'GET' && req.url === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            running: state.running, kind: state.kind, params: state.params,
            stats: state.stats, error: state.error,
            elapsed: state.running ? Math.round((Date.now() - state.startedAt) / 1000) : 0,
        }));
        return;
    }
    if (req.method === 'GET' && req.url === '/api/stream') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.write('retry: 1000\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        // Empuja el estado inicial al conectar
        pushState();
        return;
    }
    if (req.method === 'POST' && (req.url === '/api/start' || req.url === '/api/ddos' || req.url === '/api/stop')) {
        let body = '';
        req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
        req.on('end', () => {
            let p = {}; try { p = JSON.parse(body || '{}'); } catch (e) {}
            let out;
            if (req.url === '/api/start') out = startNpc(p);
            else if (req.url === '/api/ddos') out = startDdos(p);
            else { stopTest(); out = { ok: true }; }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(out));
        });
        return;
    }
    res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`PillWars Stress Bot — panel en ${url}`);
    // Auto-abrir el navegador en Windows
    if (process.platform === 'win32') {
        try { spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
    } else if (process.platform === 'darwin') {
        try { spawn('open', [url], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
    } else {
        try { spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
    }
});

process.on('SIGINT', () => { stopTest(); process.exit(0); });
process.on('SIGTERM', () => { stopTest(); process.exit(0); });
