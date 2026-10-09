// Escenas de clips-capture.js: que pasa en cada clip (30 fotogramas = 1 s).
// Cada escena coloca al jugador (y a quien haga falta) fuera de camara, deja
// que la camara se asiente y solo entonces graba.
const AYUDAS = `(() => {
  const h = window.__h = {
    keep: new Set(),
    yo() { return me().cells.slice().sort((a, b) => b.r - a.r)[0]; },
    centro() { const c = me().cells; let x = 0, y = 0; c.forEach(k => { x += k.x; y += k.y; }); return { x: x / c.length, y: y / c.length }; },
    radio(r) { const p = me(); p.cells = [p.cells.sort((a, b) => b.r - a.r)[0]]; p.cells[0].r = r; },
    pon(x, y) { const k = h.centro(); me().cells.forEach(c => { c.x += x - k.x; c.y += y - k.y; c.vx = 0; c.vy = 0; c.boostX = 0; c.boostY = 0; }); camera.x = x; camera.y = y; },
    apunta(tx, ty) { const es = getViewScale(); mouse.x = width / 2 + (tx - camera.x) * es; mouse.y = height / 2 + (ty - camera.y) * es; },
    dir(dx, dy) { const k = h.centro(); h.apunta(k.x + dx, k.y + dy); },
    // Casi quieta pero mirando hacia (tx, ty): a menos de 40 el juego frena.
    mira(tx, ty) { const k = h.centro(), d = Math.hypot(tx - k.x, ty - k.y) || 1; h.apunta(k.x + (tx - k.x) / d * 14, k.y + (ty - k.y) / d * 14); },
    // Nadie que no sea parte de la escena a menos de R del jugador.
    despeja(R) { const k = h.centro(); for (const e of sim.enemies) { if (h.keep.has(e)) continue; const dx = e.x - k.x, dy = e.y - k.y, d = Math.hypot(dx, dy) || 1; if (d < R) { e.x = k.x + dx / d * (R + 400); e.y = k.y + dy / d * (R + 400); } } },
    // Un bot de una sola pieza, para hacer de presa o de cazador.
    bot(r, x, y) { const n = {}; for (const e of sim.enemies) n[e.id] = (n[e.id] || 0) + 1; const b = sim.enemies.find(e => n[e.id] === 1 && !h.keep.has(e)); h.keep.add(b); b.r = r; b.botSkills = []; h.fija(b, x, y); return b; },   // sin skills: que no saque su SHIELD en mitad del clip
    fija(b, x, y) { b.x = x; b.y = y; b.vx = 0; b.vy = 0; b.boostX = 0; b.boostY = 0; b.sprintTime = 0; b.immuneTime = 0; b.tpPhase = 0; b.lastSplitTime = sim.now; },
    vivo(b) { return sim.enemies.includes(b); },
    virusCerca(x, y) { return sim.viruses.slice().sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]; },
    // Los demas virus, lejos de la escena (de v, o del jugador si v es null).
    soloVirus(v, R) { const c = v || h.centro(); for (const o of sim.viruses) { if (o === v || (v && window.__viejos && !__viejos.has(o))) continue; const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy) || 1; if (d < R) { o.x = c.x + dx / d * (R + 200); o.y = c.y + dy / d * (R + 200); } } },
    // Comida alrededor (para que el iman tenga que atraer).
    comida(n, r0, r1) { const k = h.centro(); const fs = sim.foods.slice().sort((a, b) => Math.hypot(a.x - k.x, a.y - k.y) - Math.hypot(b.x - k.x, b.y - k.y)).slice(0, n);
      for (const f of fs) { const a = Math.random() * Math.PI * 2, d = r0 + Math.random() * (r1 - r0); sim.foodGrid.remove(f); f.x = k.x + Math.cos(a) * d; f.y = k.y + Math.sin(a) * d; sim.foodGrid.insert(f); } },
    skill(id, tx, ty) { const p = me(); p.skillSlots = [{ id, uses: 99 }, null, null, null]; p.globalCD = 0; p.skillState[id] = 0; sim.queueAction('me', { kind: 'skill', slot: 1, tx, ty }); },
    split(tx, ty) { sim.queueAction('me', { kind: 'split', tx, ty }); },
    // Quieta en (x, y) aunque mire a otro lado.
    ancla(x, y) { for (const c of me().cells) { c.x = x; c.y = y; } },
  };
  try { closeSkillChoice(); } catch (e) {}
  // Sin coronas del podio ni la flecha de apuntar: en un clip de 4 s solo distraen.
  window.dibujaRango = () => {};
  window.drawAimGuide = () => {};
})()`;

module.exports = async ({ js, partida, avanza, graba, clip }) => {
    // Cada clip en una partida nueva: nada de lo anterior se cuela.
    // es: escala fija de la camara (pixeles por unidad de mundo) en todo el clip.
    const prepara = async (es, montaje, cada, n) => {
        await partida('arcade');
        await js(`window.__v = null; window.__viejos = null; window.__gk = 0; window.__cam = null; window.__suelto = false; window.__es = ${es}`);
        await js(AYUDAS);
        await js(`(() => { const h = __h; ${montaje} })()`);
        // Los virus que salgan durante el clip (el clon) no se apartan.
        await js(`window.__viejos = new Set(sim.viruses)`);
        await avanza(n || 50, P(cada));
        // Sin los avisos de arriba de la partida anterior (OFFLINE: QUESTS DON'T COUNT...).
        await js(`uiTexts.length = 0`);
    };
    // Cada fotograma: sin la carta de skill, sin bots de fuera, sin avisos de coronas y (si la escena no es de virus) sin virus cerca.
    const P = s => `const h = __h; try { closeSkillChoice(); } catch (e) {} h.despeja(1300); if (!window.__v) h.soloVirus(null, 1400); for (let i = uiTexts.length - 1; i >= 0; i--) if (/CROWN/.test(uiTexts[i].text)) uiTexts.splice(i, 1); ${s}`;
    const usa = (id, tx, ty) => js(`(() => { const h = __h, k = h.centro(); h.skill(${id}, ${tx || 'k.x + 300'}, ${ty || 'k.y'}); })()`);

    // ---- SPLIT: una pildora mas pequena delante; SPACE y el trozo se la come ----
    await clip('split', async () => {
        await prepara(1.0, `h.radio(60); h.pon(0, 0); window.__cam = { x: 170, y: 0 }; window.__presa = h.bot(22, 340, 10);`, `h.fija(__presa, 340, 10); h.ancla(0, 0); h.mira(340, 10);`);
        await graba(18, P(`h.fija(__presa, 340, 10); h.ancla(0, 0); h.mira(340, 10);`));
        await js(`__h.split(340, 10)`);
        await graba(66, P(`if (h.vivo(__presa)) h.fija(__presa, 340, 10); h.mira(600, 10);`));
    });

    // ---- VIRUS: una pildora grande entra en un virus y se parte en trozos ----
    await clip('virus', async () => {
        await prepara(0.6, `const v = window.__v = h.virusCerca(0, 0); h.soloVirus(v, 1400); h.radio(Math.max(105, v.r * 1.5)); h.pon(v.x - 420, v.y + 10);`, `h.soloVirus(__v, 1400); h.dir(1, 0);`);
        await graba(120, P(`h.soloVirus(__v, 1400); h.apunta(__v.x + 600, __v.y);`));
    });

    // Un virus en medio: tu a la izquierda (quieta, apuntando) y, si hace falta, un rival a la derecha.
    const duelo = (es, rYo, dYo, rRival, dRival, camDx) => `const v = window.__v = h.virusCerca(0, 0); h.soloVirus(v, 1400); h.radio(${rYo});
        window.__vx = v.x; window.__vy = v.y; window.__ax = v.x - ${dYo}; window.__ay = v.y; h.pon(__ax, __ay);
        window.__cam = { x: v.x + ${camDx}, y: v.y }; window.__rx = v.x + ${dRival}; ${rRival ? `window.__r = h.bot(${rRival}, __rx, v.y);` : ''}`;

    // ---- COMBO: te persigue uno enorme; SPRINT para escapar, MAGNET mientras corres y BLINK cuando ya te alcanza ----
    await clip('combo', async () => {
        await prepara(0.85, `h.radio(45); h.pon(0, 0); window.__gap = 700; window.__g = h.bot(110, -700, 0); window.__cam = { x: -350, y: 0 };`,
            `h.dir(400, 0); const k = h.centro(); h.fija(__g, k.x - __gap, k.y); __cam.x = k.x - __gap / 2; __cam.y = k.y;`, 30);
        // El cazador va detras a __gap (que se acorta o se alarga); la camara, entre los dos.
        const sigue = dg => P(`h.dir(400, 0); window.__gap += ${dg}; const k = h.centro(); if (h.vivo(__g)) h.fija(__g, k.x - __gap, k.y);
            const tx = k.x - __gap / 2; __cam.x += (tx - __cam.x) * 0.15; __cam.y += (k.y - __cam.y) * 0.15;`);
        await graba(24, sigue(-8));
        await usa(3);
        await graba(26, sigue(4));
        await js(`__h.comida(60, 120, 300)`);
        await usa(5);
        await graba(34, sigue(-8));
        await js(`(() => { const k = __h.centro(), pa = sim.puntoAzar; sim.puntoAzar = () => ({ x: k.x + 650, y: k.y - 260 }); __h.skill(4, k.x + 300, k.y); window.__pa = pa; })()`);
        await graba(2, sigue(0));
        await js(`sim.puntoAzar = window.__pa`);
        // Ya en el sitio nuevo: el cazador sigue de largo y la camara se va contigo.
        await graba(50, P(`h.dir(400, 0); if (h.vivo(__g)) h.fija(__g, __g.x + 4, __g.y); const k = h.centro(); __cam.x += (k.x - 150 - __cam.x) * 0.08; __cam.y += (k.y - __cam.y) * 0.08;`));
    });

    // ---- SHOOT: primer disparo, el virus se vuelve morado; segundo, sale disparado y revienta al rival ----
    await clip('shoot', async () => {
        await prepara(1.1, duelo(1.1, 50, 230, 70, 300, 35), `h.soloVirus(__v, 1400); h.fija(__r, __rx, __vy); h.ancla(__ax, __ay); h.mira(__vx, __vy);`);
        const cada = P(`h.soloVirus(__v, 1400); if (h.vivo(__r) && !window.__suelto) h.fija(__r, __rx, __vy); h.ancla(__ax, __ay); h.mira(__vx, __vy);`);
        await graba(12, cada);
        await usa(2, '__vx', '__vy');
        await graba(30, cada);
        await usa(2, '__vx', '__vy');
        await graba(12, cada);
        await js(`window.__suelto = true`);
        await graba(56, cada);
    });

    // ---- CLON: dos disparos de masa al virus y sale un virus nuevo ----
    await clip('clon', async () => {
        await prepara(0.9, duelo(0.9, 60, 280, 0, 0, 130), `h.soloVirus(__v, 1400); h.ancla(__ax, __ay); h.mira(__vx, __vy);`);
        const cada = P(`h.soloVirus(__v, 1400); h.ancla(__ax, __ay); h.mira(__vx, __vy);`);
        await graba(12, cada);
        await usa(1, '__vx', '__vy');
        await graba(34, cada);
        await usa(1, '__vx', '__vy');
        await graba(70, cada);
    });

    // ---- SPRINT: acelera con el aura dorada ----
    await clip('sprint', async () => {
        await prepara(1.2, `h.radio(50); h.pon(0, 0);`, `h.dir(300, 60);`);
        await graba(18, P(`h.dir(300, 60);`));
        await usa(3);
        await graba(100, P(`const t = sim.now / 700; h.dir(300 * Math.cos(t * 0.6), 300 * Math.sin(t * 0.6) + 60);`));
    });

    // ---- BLINK: se teletransporta cerca (el destino lo fija la escena para que se vea) ----
    await clip('blink', async () => {
        await prepara(1.0, `h.radio(50); h.pon(0, 0);`, `h.dir(300, 0);`);
        await graba(24, P(`h.dir(300, 0);`));
        await js(`(() => { const k = __h.centro(), pa = sim.puntoAzar; sim.puntoAzar = () => ({ x: k.x + 520, y: k.y - 160 }); __h.skill(4, k.x + 300, k.y); window.__pa = pa; })()`);
        await graba(2, P(`h.dir(300, 0);`));
        await js(`sim.puntoAzar = window.__pa`);
        await graba(84, P(`h.dir(300, 0);`));
    });

    // ---- MAGNET: la comida de alrededor vuela hacia la pildora ----
    await clip('magnet', async () => {
        await prepara(1.05, `h.radio(42); h.pon(0, 0);`, `h.ancla(0, 0); h.mira(300, 40);`);
        await js(`__h.comida(45, 110, 250)`);
        await graba(10, P(`h.ancla(0, 0); h.mira(300, 40);`));
        await usa(5);
        await graba(66, P(`h.ancla(0, 0); h.mira(300, 40);`));
    });

    // ---- SHIELD: un rival enorme pasa por encima y no se la come ----
    await clip('shield', async () => {
        await prepara(0.8, `h.radio(45); h.pon(0, 0); window.__g = h.bot(150, 700, 0);`, `h.fija(__g, 700, 0); h.ancla(0, 0); h.mira(300, 0);`);
        await graba(8, P(`h.fija(__g, 700, 0); h.ancla(0, 0); h.mira(300, 0);`));
        await usa(6);
        await graba(110, P(`const k = Math.min(1, (window.__gk = (window.__gk || 0) + 1) / 95); h.fija(__g, 700 - 1400 * k, 0); h.ancla(0, 0); h.mira(300, 0);`));
    });

    // ---- PLUS: masa de golpe ----
    await clip('plus', async () => {
        await prepara(1.4, `h.radio(40); h.pon(0, 0);`, `h.ancla(0, 0); h.mira(300, 60);`);
        await graba(18, P(`h.ancla(0, 0); h.mira(300, 60);`));
        await usa(7);
        await graba(72, P(`h.ancla(0, 0); h.mira(300, 60);`));
    });

    // ---- GAMBLE: primero pierde (-5000) y luego sale el JACKPOT (+15000) ----
    await clip('gamble', async () => {
        await prepara(1.2, `h.radio(42); h.pon(0, 0);`, `h.ancla(0, 0); h.mira(300, 60);`);
        const cada = P(`h.ancla(0, 0); h.mira(300, 60);`);
        const tira = async azar => {
            await js(`(() => { window.__rnd = Math.random; Math.random = () => ${azar}; __h.skill(8, 0, 0); })()`);
            await graba(1, cada);
            await js(`Math.random = window.__rnd`);
        };
        await graba(15, cada);
        await tira(0.1);
        await graba(50, cada);
        await tira(0.9);
        await graba(60, cada);
    });
};
