// Receives the frames captured from the real game and writes them to
// public/arena/, where the video picks them up.
//   node tools/origin-video/capture/receiver.js
// A WebSocket and not HTTP POST: the game page's CSP only lets it connect to
// its own origin and to ws:, and loosening the game's CSP for a video tool
// would be the wrong trade.
// Messages: a text frame with the file name ("0001.jpg" or "events.json" or
// "reset"), followed (except for reset) by one binary/text frame with the data.
// Only listens on 127.0.0.1.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

const OUT = path.join(__dirname, '..', 'public', 'arena');
const PORT = 8197;
const NAME = /^(\d{4}\.jpg|events\.json)$/;

const server = http.createServer((req, res) => { res.end('origin-video frame receiver'); });
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
    let pending = null;
    ws.on('message', (data, isBinary) => {
        if (pending) {
            fs.mkdirSync(OUT, { recursive: true });
            fs.writeFileSync(path.join(OUT, pending), data);
            ws.send('ok ' + pending);
            pending = null;
            return;
        }
        const name = String(data);
        if (!isBinary && name === 'reset') {
            fs.rmSync(OUT, { recursive: true, force: true });
            fs.mkdirSync(OUT, { recursive: true });
            ws.send('ok reset');
        } else if (!isBinary && NAME.test(name)) pending = name;
        else ws.send('bad ' + name.slice(0, 40));
    });
});
server.listen(PORT, '127.0.0.1', () => console.log('receiver on ws://127.0.0.1:' + PORT + ' -> ' + OUT));
