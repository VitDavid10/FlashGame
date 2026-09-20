// Receives the frames captured from the real game and writes them under
// public/, where the video picks them up: the arena kills in arena/, the
// skill clips in skills/ and the three kill clips in deaths/.
//   node tools/origin-video/capture/receiver.js
// A WebSocket and not HTTP POST: the game page's CSP only lets it connect to
// its own origin and to ws:, and loosening the game's CSP for a video tool
// would be the wrong trade.
// Messages: a text frame with the file name ("0001.jpg", "skills/0001.jpg",
// "events.json"), or "reset <dir>", or "director" (which answers with
// director.js, so the page can load it without pasting). Every name but the
// resets and "director" is followed by one frame with the data.
// Only listens on 127.0.0.1.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

const OUT = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 8197;   // another capture running? give this one its own port
const DIRS = ['arena', 'skills', 'deaths', 'growth'];
const NAME = new RegExp('^(' + DIRS.join('|') + ')/(\\d{4}\\.jpg|events\\.json)$');

const server = http.createServer((req, res) => { res.end('origin-video frame receiver'); });
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
    let pending = null;
    ws.on('message', (data, isBinary) => {
        if (pending) {
            const file = path.join(OUT, pending);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, data);
            ws.send('ok ' + pending);
            pending = null;
            return;
        }
        const name = String(data);
        if (!isBinary && name === 'director') { ws.send('src ' + fs.readFileSync(path.join(__dirname, 'director.js'), 'utf8')); return; }
        const reset = !isBinary && /^reset (\w+)$/.exec(name);
        if (reset && DIRS.includes(reset[1])) {
            const dir = path.join(OUT, reset[1]);
            fs.rmSync(dir, { recursive: true, force: true });
            fs.mkdirSync(dir, { recursive: true });
            ws.send('ok ' + name);
        } else if (!isBinary && NAME.test(name)) pending = name;
        else ws.send('bad ' + name.slice(0, 40));
    });
});
server.listen(PORT, '127.0.0.1', () => console.log('receiver on ws://127.0.0.1:' + PORT + ' -> ' + OUT));
