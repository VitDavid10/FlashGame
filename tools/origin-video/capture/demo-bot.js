// Page-side pilot for the Demo captures: steers the player's pill through the
// game's own mouse (so the client sends its normal input). It eats food and
// what is smaller, runs from what is bigger and, when it sees one of the names
// in `hunt` small enough, goes for it and splits onto it. Names in `spare` are
// left alone (the puppets, until it is their turn).
// Injected with Runtime.evaluate; window.__bot.cfg can be changed on the fly.
module.exports = `(() => {
  if (window.__bot) clearInterval(window.__bot.iv);
  const B = window.__bot = { cfg: { hunt: [], spare: [], split: true, fleeK: 1.1, eatK: 0.85 }, lastSplit: 0, wander: null };
  B.iv = setInterval(() => {
    try {
      if (!gameRunning || !sim || isSpectating) return;
      // Arenas offer a skill now and then: the first one is taken after a moment on screen.
      if (typeof isPickingSkill !== 'undefined' && isPickingSkill) {
        if (!B.pickAt) B.pickAt = performance.now() + 1300;
        else if (performance.now() > B.pickAt) { B.pickAt = 0; const o = els.skillOpts && els.skillOpts.children[0]; if (o) o.click(); }
      } else B.pickAt = 0;
      const m = me(); if (!m || !m.alive || !m.cells.length) return;
      let x = 0, y = 0, M = 0, big = 0;
      for (const c of m.cells) { const k = c.r * c.r; x += c.x * k; y += c.y * k; M += k; big = Math.max(big, c.r); }
      x /= M; y /= M;
      const cfg = B.cfg, hunt = new Set((cfg.hunt || []).map(s => String(s).toLowerCase())), spare = new Set((cfg.spare || []).map(s => String(s).toLowerCase()));
      let flee = null, fd = 1e9, prey = null, pd = 1e9, rival = null, rd = 1e9;
      for (const e of sim.enemies || []) {
        if (!e || !(e.r > 0)) continue;
        const d = Math.hypot(e.x - x, e.y - y) - e.r - big;
        const nm = String(e.name || '').toLowerCase(), isRival = hunt.has(nm);
        if (e.r > big * cfg.fleeK) { if (d < fd) { fd = d; flee = e; } continue; }
        if (spare.has(nm)) continue;
        if (e.r < big * cfg.eatK) {
          if (isRival) { if (d < rd) { rd = d; rival = e; } }
          else if (d < pd) { pd = d; prey = e; }
        }
      }
      // Viruses split a pill that is bigger than them: steer around the ones ahead.
      let vx = 0, vy = 0;
      for (const v of sim.viruses || []) {
        if (!v || !(v.r > 0) || big < v.r * 1.05) continue;
        const dx = x - v.x, dy = y - v.y, d = Math.hypot(dx, dy) - v.r - big;
        if (d < 260) { const w = (260 - d) / 260; vx += dx / (Math.hypot(dx, dy) || 1) * w; vy += dy / (Math.hypot(dx, dy) || 1) * w; }
      }
      let tx, ty;
      const now = performance.now();
      if (flee && fd < 200 + flee.r * 3 + big && !(rival && rd < fd)) { tx = x + (x - flee.x); ty = y + (y - flee.y); }
      else if (rival) {
        tx = rival.x; ty = rival.y;
        if (cfg.split && m.cells.length === 1 && rival.r < big * 0.6 && rd < big * 2.2 && now - B.lastSplit > 3000) { B.lastSplit = now; B.pendingSplit = true; }
      }
      else if (prey && pd < 700) { tx = prey.x; ty = prey.y; }
      else {
        let best = null, bd = 1e12;
        const fs = sim.foods || [];
        for (let i = 0; i < fs.length; i += 3) { const f = fs[i]; if (!f) continue; const d = (f.x - x) ** 2 + (f.y - y) ** 2; if (d < bd) { bd = d; best = f; } }
        if (best) { tx = best.x; ty = best.y; } else { tx = x + 200; ty = y; }
      }
      if (vx || vy) { const L = Math.hypot(tx - x, ty - y) || 1; tx = x + (tx - x) / L * 300 + vx * 500; ty = y + (ty - y) / L * 300 + vy * 500; }
      const es = getViewScale();
      mouse.x = width / 2 + (tx - camera.x) * es; mouse.y = height / 2 + (ty - camera.y) * es;
      if (B.pendingSplit) { B.pendingSplit = false; splitPlayer(); }
    } catch (e) { B.err = String(e); }
  }, 60);
  return 'bot on';
})()`;
