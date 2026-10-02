/*
 * Service worker de la app de la dApp Store: guarda lo que carga el juego para
 * que sin conexion siga abriendo y se pueda jugar offline.
 *
 * Red primero (asi un `actualizar` del VPS se ve al momento) y, si no hay red
 * o tarda demasiado teniendo copia, la copia guardada. Las /api/ nunca se
 * guardan: sin red fallan y el juego ya lo lleva (quests, salas, airdrop).
 * Lo que la pagina cargo antes de que este worker existiera se lo pasa ella
 * con un mensaje { guarda: [urls] } (ver el registro en index.html).
 */
const CACHE = 'pw-app-v1';
const ESPERA_MS = 4000;   // con copia guardada, no esperar a una red que no contesta

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

function guardable(url) {
    return url.origin === self.location.origin && !url.pathname.startsWith('/api/');
}

// La pagina se guarda sin query (?app, ?ref...): offline vale cualquiera.
function clave(req) {
    if (req.mode !== 'navigate') return req.url;
    const u = new URL(req.url); u.search = ''; u.hash = '';
    return u.href;
}

async function guarda(key, res) {
    // 206 (audio/video por rangos) no se puede guardar: ya bajara entero.
    if (!res || res.status !== 200 || res.type === 'opaque') return;
    const c = await caches.open(CACHE);
    await c.put(key, res);
}

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (!guardable(url)) return;
    const key = clave(req);
    e.respondWith((async () => {
        const copia = await caches.match(key, { ignoreSearch: req.mode === 'navigate' });
        const red = fetch(req).then(res => { e.waitUntil(guarda(key, res.clone())); return res; });
        if (!copia) return red;
        const tarde = new Promise(r => setTimeout(() => r(null), ESPERA_MS));
        try { return (await Promise.race([red, tarde])) || copia; } catch (err) { return copia; }
    })());
});

self.addEventListener('message', e => {
    const urls = e.data && Array.isArray(e.data.guarda) ? e.data.guarda : [];
    e.waitUntil((async () => {
        const c = await caches.open(CACHE);
        for (const u of urls) {
            let url; try { url = new URL(u, self.location.href); } catch (err) { continue; }
            if (!guardable(url) || await c.match(url.href)) continue;
            try { await guarda(url.href, await fetch(url.href)); } catch (err) {}
        }
    })());
});
