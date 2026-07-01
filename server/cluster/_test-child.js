'use strict';
// Hijo del test de IPC. Registra handlers y hace una request de vuelta al padre.
const { createIpc } = require('./ipc.js');
const ipc = createIpc(process, { label: 'child' });

// El padre nos pedirá 'echo' y 'boom'.
ipc.handle('echo', (data) => ({ got: data, pid: process.pid }));
ipc.handle('boom', () => { throw new Error('explota a propósito'); });

// Nosotros le pedimos al padre que nos cobre (simula authorizeEntry cross-proceso).
(async () => {
    try {
        const res = await ipc.request('charge', { wallet: 'W1', amount: 50000 });
        ipc.notify('childDone', { charged: res });
    } catch (e) {
        ipc.notify('childDone', { error: String(e.message) });
    }
})();
