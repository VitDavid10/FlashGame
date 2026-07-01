'use strict';
/*
 * ipc — canal request/response sobre el IPC de child_process.fork.
 *
 * Fase 4 (split multiproceso). El Director y cada Host hablan por el canal que
 * fork() abre gratis (process.send / .on('message')). Ese canal es fire-and-
 * forget; aquí le montamos encima:
 *   - request(type, payload) → Promise que resuelve con la respuesta del otro lado.
 *   - handle(type, fn)       → registra un manejador; su valor (o promesa) se
 *                              devuelve al que hizo request.
 *   - notify(type, payload)  → mensaje sin respuesta (fire-and-forget).
 *
 * Correlación por id incremental. Timeout configurable para no colgar promesas
 * si el otro proceso muere a mitad (el dinero NO puede quedar en promesa eterna).
 *
 * `channel` es cualquier objeto con .send(msg) y .on('message', cb):
 * el propio `process` en el host, o el objeto ChildProcess en el director.
 */

function createIpc(channel, opts = {}) {
    const timeoutMs = opts.timeoutMs || 5000;
    const label = opts.label || 'ipc';
    const pending = new Map();          // id → { resolve, reject, timer }
    const handlers = new Map();         // type → fn(payload) → result|Promise
    let seq = 0;

    channel.on('message', async (msg) => {
        if (!msg || typeof msg !== 'object' || !msg.__ipc) return;
        if (msg.__ipc === 'res') {
            const p = pending.get(msg.id);
            if (!p) return;             // respuesta tardía tras timeout: se ignora
            pending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.err) p.reject(new Error(msg.err));
            else p.resolve(msg.data);
            return;
        }
        if (msg.__ipc === 'req') {
            const fn = handlers.get(msg.type);
            if (!fn) {
                if (msg.id != null) channel.send({ __ipc: 'res', id: msg.id, err: 'no handler for ' + msg.type });
                return;
            }
            try {
                const data = await fn(msg.data);
                if (msg.id != null) channel.send({ __ipc: 'res', id: msg.id, data });
            } catch (e) {
                if (msg.id != null) channel.send({ __ipc: 'res', id: msg.id, err: String(e && e.message || e) });
            }
            return;
        }
        if (msg.__ipc === 'note') {
            const fn = handlers.get(msg.type);
            if (fn) { try { fn(msg.data); } catch (e) {} }
        }
    });

    function request(type, payload) {
        return new Promise((resolve, reject) => {
            const id = ++seq;
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`${label}: timeout esperando respuesta de '${type}' (${timeoutMs}ms)`));
            }, timeoutMs);
            pending.set(id, { resolve, reject, timer });
            try {
                channel.send({ __ipc: 'req', id, type, data: payload });
            } catch (e) {
                pending.delete(id); clearTimeout(timer); reject(e);
            }
        });
    }

    function notify(type, payload) {
        try { channel.send({ __ipc: 'note', type, data: payload }); } catch (e) {}
    }

    function handle(type, fn) { handlers.set(type, fn); }

    // Rechaza todas las promesas pendientes (p.ej. si el otro proceso muere).
    function failAll(reason) {
        for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error(reason)); }
        pending.clear();
    }

    return { request, notify, handle, failAll };
}

module.exports = { createIpc };
