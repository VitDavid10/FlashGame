// Evalua una expresion JS en la pagina del WebView de la app (build debug).
// Antes: adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
// Uso: node tools/android/cdp-eval.js "<expresion>"   (admite await; devuelve JSON)
// El pid sale de: adb shell cat /proc/net/unix | grep webview_devtools_remote
'use strict';
const WebSocket = require('ws');

const expr = process.argv[2];
if (!expr) { console.error('falta la expresion'); process.exit(2); }

(async () => {
    const lista = await (await fetch('http://127.0.0.1:9222/json')).json();
    const pag = lista.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
    if (!pag) { console.error('sin paginas: ' + JSON.stringify(lista)); process.exit(1); }
    const ws = new WebSocket(pag.webSocketDebuggerUrl);
    await new Promise((ok, ko) => { ws.once('open', ok); ws.once('error', ko); });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
        expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true } }));
    const res = await new Promise(ok => ws.on('message', m => { const d = JSON.parse(m); if (d.id === 1) ok(d); }));
    ws.close();
    if (res.result && res.result.exceptionDetails) { console.log('EXCEPCION: ' + JSON.stringify(res.result.exceptionDetails.exception || res.result.exceptionDetails)); process.exit(1); }
    console.log(JSON.stringify(res.result && res.result.result && res.result.result.value, null, 1));
    process.exit(0);
})().catch(e => { console.error('ERROR ' + e.message); process.exit(1); });
