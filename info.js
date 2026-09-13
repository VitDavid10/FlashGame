/*
 * Shared behaviour for the info pages (privacy, treasury, contact):
 * - draws the pixel pill of the logo and the red pixel plate of PLAY NOW, with
 *   the same algorithms the landing page uses, so they are the same pieces;
 * - PLAY NOW asks for a name with the same box as the landing page;
 * - on touch screens a tap on PLAY NOW opens or closes MODES/SKINS instead of
 *   relying on hover, like the landing navbar.
 */
(function () {
    // Pixel pill (port of pixPillUrl in index.html): dark outline, shadow band,
    // seam between halves, light band and highlight. White top, mint bottom.
    function pillUrl(wL, hL, rgbT, rgbB) {
        var cv = document.createElement('canvas'); cv.width = wL; cv.height = hL;
        var g = cv.getContext('2d'), R = wL / 2, half = Math.floor(hL / 2);
        var shade = function (rgb, amt) { var t = amt < 0 ? 0 : 255, a = Math.abs(amt); return 'rgb(' + rgb.map(function (v) { return Math.round(v + (t - v) * a); }).join(',') + ')'; };
        var inside = function (x, y) {
            if (x < 0 || y < 0 || x >= wL || y >= hL) return false;
            var cy = Math.min(Math.max(y + 0.5, R), hL - R), dx = x + 0.5 - R, dy = y + 0.5 - cy;
            return dx * dx + dy * dy <= (R - 0.1) * (R - 0.1);
        };
        for (var y = 0; y < hL; y++) for (var x = 0; x < wL; x++) {
            if (!inside(x, y)) continue;
            var rgb = y < half ? rgbT : rgbB, col;
            if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) col = shade(rgb, -0.55);
            else if (!inside(x + 2, y) || !inside(x, y + 2)) col = shade(rgb, -0.25);
            else if (y === half || y === half - 1) col = shade(rgb, -0.18);
            else if (!inside(x - 2, y) || !inside(x, y - 2)) col = shade(rgb, 0.18);
            else col = 'rgb(' + rgb.join(',') + ')';
            g.fillStyle = col; g.fillRect(x, y, 1, 1);
        }
        var hs = Math.max(1, Math.round(wL / 6));
        g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(Math.round(wL * 0.22), Math.round(hL * 0.14), hs, hs);
        return cv.toDataURL();
    }
    // Red pixel plate (port of placa() in index.html): stepped corners, dark rim
    // of its own colour, light bevel top-left.
    function plateUrl() {
        var W = 48, H = 11, CUT = 2, RGB = [246, 42, 45];
        var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        var g = cv.getContext('2d');
        var sh = function (f) { return RGB.map(function (v) { return Math.min(255, Math.round(v * f)); }); };
        var lit = function (t) { return RGB.map(function (v) { return Math.round(v + (255 - v) * t); }); };
        var inside = function (x, y) {
            if (x < 0 || y < 0 || x >= W || y >= H) return false;
            var dx = Math.min(x, W - 1 - x), dy = Math.min(y, H - 1 - y);
            return dx >= CUT || dy >= CUT || dx + dy >= CUT;
        };
        var img = g.createImageData(W, H), px = img.data;
        var C_RIM = sh(0.38), C_LIT = lit(0.32), C_DIM = sh(0.70);
        for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
            if (!inside(x, y)) continue;
            var ring = 2;
            for (var r = 1; r <= 2 && ring === 2; r++) {
                for (var oy = -1; oy <= 1 && ring === 2; oy++) for (var ox = -1; ox <= 1; ox++) {
                    if ((!ox && !oy) || inside(x + ox * r, y + oy * r)) continue;
                    ring = r - 1; break;
                }
            }
            var col = ring === 0 ? C_RIM : ring === 1 ? (Math.min(y, x) <= Math.min(H - 1 - y, W - 1 - x) ? C_LIT : C_DIM) : RGB;
            var i = ((y * W + x) << 2);
            px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        return cv.toDataURL();
    }
    document.documentElement.style.setProperty('--info-plate', 'url(' + plateUrl() + ')');

    // PLAY NOW asks for a name first, with the same box as the landing page
    // (HeroPlayModal in index.html), and then starts the quick arcade match.
    function setupNameBox() {
        var modal = document.createElement('div');
        modal.className = 'name-modal';
        modal.innerHTML = '<div class="name-box" role="dialog" aria-label="Enter your name">' +
            '<button type="button" class="name-close" aria-label="Close"></button>' +
            '<div class="name-title">Enter your name</div>' +
            '<input class="name-field" type="text" maxlength="12" placeholder="Your name" autocomplete="off" spellcheck="false">' +
            '<button type="button" class="name-go">PLAY NOW</button></div>';
        document.body.appendChild(modal);
        var input = modal.querySelector('.name-field');
        function close() { modal.classList.remove('show'); }
        function go() { var name = (input.value || '').trim().slice(0, 12); close(); location.href = '/game/?heroplay=1&name=' + encodeURIComponent(name); }
        modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
        modal.querySelector('.name-close').addEventListener('click', close);
        modal.querySelector('.name-go').addEventListener('click', go);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); else if (e.key === 'Escape') close(); });
        document.querySelectorAll('.btn-play').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                input.value = '';
                modal.classList.add('show');
                setTimeout(function () { input.focus(); }, 50);
            });
        });
    }

    function mount() {
        var pill = 'url(' + pillUrl(8, 15, [255, 255, 255], [0, 255, 136]) + ')';
        document.querySelectorAll('.logo-pill').forEach(function (el) { el.style.backgroundImage = pill; });

        var touch = window.matchMedia('(hover: none), (pointer: coarse)').matches;
        if (!touch) { setupNameBox(); return; }
        document.querySelectorAll('.play-area').forEach(function (area) {
            // Capture phase: the tap only toggles the menu, the links inside it
            // still go to their page.
            area.addEventListener('click', function (e) {
                if (e.target.closest('.play-menu')) return;
                e.preventDefault(); e.stopPropagation();
                area.classList.toggle('open');
            }, true);
        });
        document.addEventListener('click', function (e) {
            if (!e.target.closest('.play-area')) document.querySelectorAll('.play-area.open').forEach(function (a) { a.classList.remove('open'); });
        }, true);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
