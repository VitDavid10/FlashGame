// Iconos pixel 16x16 dibujados por codigo: se pintan las piezas y el contorno negro sale solo (como los sprites del juego).
window.pwPixIcon = (function () {
    const N = 16;
    function rejilla() { return Array.from({ length: N }, () => Array(N).fill(null)); }
    function contorno(g) {
        const out = g.map(r => r.slice());
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            if (g[y][x]) continue;
            if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy] && g[y + dy][x + dx])) out[y][x] = '#0b0f05';
        }
        return out;
    }
    const rect = (g, x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g[y] && x >= 0 && x < N) g[y][x] = c; };
    const px = (g, x, y, c) => { if (g[y] && x >= 0 && x < N) g[y][x] = c; };
    // cabeza redonda 5x5 (esquinas fuera) con sombra a la derecha; cuerpo con hombros redondeados
    const cabeza = (g, x, y, c, sh) => { rect(g, x, y, x + 4, y + 4, c); rect(g, x + 4, y + 1, x + 4, y + 3, sh); [[x, y], [x + 4, y], [x, y + 4], [x + 4, y + 4]].forEach(([i, j]) => px(g, i, j, null)); };
    const cuerpo = (g, x0, y0, x1, c, sh) => { rect(g, x0 + 1, y0, x1 - 1, y0, c); rect(g, x0, y0 + 1, x1, 15, c); rect(g, x1 - 1, y0 + 1, x1, 15, sh); };
    const W = '#ffffff', L = '#c8cdd2', D = '#6b7378', Y = '#ffd23a', YD = '#c99a12', BR = '#8a5a2b';
    const dib = {
        swords(a, ad) {
            const g = rejilla();
            for (let i = 1; i <= 9; i++) { px(g, i, i, W); px(g, i + 1, i, L); px(g, 14 - i, i, W); px(g, 15 - i, i, L); }
            // guardas
            [[8, 11], [9, 10], [11, 8], [12, 7]].forEach(([x, y]) => { px(g, x, y, Y); px(g, 15 - x, y, Y); });
            // empunaduras y pomos
            [[11, 11], [12, 12]].forEach(([x, y]) => { px(g, x, y, a); px(g, 15 - x, y, a); });
            px(g, 13, 13, YD); px(g, 2, 13, YD);
            return g;
        },
        bag(a, ad) {
            const g = rejilla();
            rect(g, 2, 6, 13, 14, a); rect(g, 12, 6, 13, 14, ad); rect(g, 2, 6, 13, 6, ad);
            // asa
            for (let y = 2; y <= 5; y++) { px(g, 5, y, D); px(g, 10, y, D); }
            rect(g, 6, 2, 9, 2, D);
            // pildora dibujada en la bolsa
            rect(g, 6, 9, 7, 11, W); rect(g, 8, 9, 9, 11, '#00e64d'); px(g, 6, 9, null); px(g, 9, 11, null);
            px(g, 3, 8, W); px(g, 3, 9, W);
            return g;
        },
        quests(a, ad) {
            const g = rejilla();
            rect(g, 2, 3, 13, 14, BR); rect(g, 3, 5, 12, 13, W);
            rect(g, 6, 1, 9, 3, D); rect(g, 7, 1, 8, 1, L);
            for (const y of [7, 9, 11]) rect(g, 7, y, 11, y, L);
            // marcas: dos hechas y una por hacer
            px(g, 4, 7, a); px(g, 5, 6, a); px(g, 4, 9, a); px(g, 5, 8, a); rect(g, 4, 11, 5, 11, D);
            return g;
        },
        addfriend(a, ad) {
            const g = rejilla();
            cabeza(g, 3, 1, W, L); cuerpo(g, 1, 9, 11, a, ad);
            rect(g, 12, 3, 14, 3, Y); rect(g, 13, 2, 13, 4, Y);
            return g;
        },
        group(a, ad) {
            const g = rejilla();
            cabeza(g, 8, 1, L, D); cuerpo(g, 7, 8, 15, ad, ad);
            cabeza(g, 2, 3, W, L); cuerpo(g, 0, 10, 9, a, ad);
            return g;
        },
        music(a, ad) {
            const g = rejilla();
            rect(g, 9, 2, 10, 11, W); rect(g, 11, 2, 13, 3, W); rect(g, 12, 4, 13, 5, W);
            rect(g, 4, 10, 9, 13, W); rect(g, 5, 9, 8, 9, W); rect(g, 4, 13, 8, 13, L); px(g, 5, 10, a); px(g, 6, 10, a);
            return g;
        },
        back(a, ad) {
            const g = rejilla();
            for (let i = 0; i <= 5; i++) rect(g, 3 + i, 7 - i, 3 + i, 8 + i, W);
            rect(g, 8, 5, 13, 10, W); rect(g, 8, 9, 13, 10, L);
            return g;
        },
        swap(a, ad) {
            const g = rejilla();
            rect(g, 2, 4, 11, 5, W); for (let i = 0; i <= 2; i++) rect(g, 11 + i, 2 + i, 11 + i, 7 - i, W);
            rect(g, 4, 10, 13, 11, L); for (let i = 0; i <= 2; i++) rect(g, 4 - i, 8 + i, 4 - i, 13 - i, L);
            return g;
        },
    };
    // Devuelve un canvas 16x16 (escalar con CSS + image-rendering:pixelated).
    return function (nombre, a, ad) {
        const g = contorno(dib[nombre](a || '#ccff00', ad || '#8fb300'));
        const c = document.createElement('canvas'); c.width = c.height = N;
        const x = c.getContext('2d');
        for (let y = 0; y < N; y++) for (let i = 0; i < N; i++) if (g[y][i]) { x.fillStyle = g[y][i]; x.fillRect(i, y, 1, 1); }
        c.style.imageRendering = 'pixelated';
        return c;
    };
})();
