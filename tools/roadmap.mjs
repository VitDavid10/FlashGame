// Genera docs/roadmap/data.js a partir de docs/roadmap/entregables.json y del historial de git:
// fechas, duración, tramos de trabajo, commits y líneas cambiadas por disciplina de cada entregable.
// Uso: npm run roadmap (después de cada commit que cierre o amplíe un entregable).
// Vive en docs/ porque el servidor no sirve esa carpeta: el roadmap no sale en pillwars.fun.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const dir = new URL('docs/roadmap/', root);
const def = JSON.parse(readFileSync(new URL('entregables.json', dir), 'utf8'));
const testeo = new Set(def.testeo);

// Commits con fecha, mensaje y líneas cambiadas por fichero.
const raw = execSync('git log --reverse --numstat --format=@@%h%x1f%ad%x1f%s --date=format:%Y-%m-%dT%H:%M', {
  cwd: root, encoding: 'utf8', maxBuffer: 256 << 20,
});
const log = [];
for (const line of raw.split('\n')) {
  if (line.startsWith('@@')) {
    const [hash, date, title] = line.slice(2).split('\x1f');
    log.push({ hash, date, title, files: [] });
  } else if (line.trim()) {
    const [add, del, file] = line.split('\t');
    if (add !== '-') log[log.length - 1].files.push([file, +add + +del]);
  }
}

/** Disciplina de cada fichero, por su carpeta. */
function discipline(f) {
  if (/^(programs|target)\/|^Anchor\.toml$|^Cargo\.(toml|lock)$/.test(f)) return 'Blockchain';
  if (/^android\//.test(f)) return 'Mobile app';
  if (/^(tools\/origin-video|video|docs\/bocetos)\//.test(f)) return 'Video & marketing';
  if (/^(game\/img|img|fonts|snd)\/|\.(png|jpe?g|webp|gif|mp3|wav|ogg|mp4|webm)$/.test(f)) return 'Art & sound';
  if (/^server\/admin\.html$/.test(f)) return 'Admin panel';
  if (/^(server|shared)\//.test(f)) return 'Server';
  if (/^game\//.test(f)) return 'Game client';
  if (/^[^/]+\.(html|css|js)$|^archive\//.test(f)) return 'Website';
  if (/^(tests|stress_bot|scripts|tools)\//.test(f)) return 'Tools & tests';
  if (/\.md$|^docs\//.test(f)) return 'Design & docs';
  return 'Infrastructure';
}

const ms = (d) => new Date(d).getTime();
/** Fecha en hora local, con el mismo formato que git (AAAA-MM-DDTHH:MM). */
const local = (t) => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const index = new Map(log.map((c, i) => [c.hash, i]));
const used = new Set();
const SESSION_GAP = 75; // min: más que esto desde el commit anterior = empieza una sesión nueva

const entregables = def.entregables.map((e) => {
  if (!e.commits) return { ...e, estado: 'pendiente' };
  const commits = e.commits.map((h) => {
    const i = index.get(h);
    if (i === undefined) throw new Error(`${e.id}: no existe el commit ${h}`);
    used.add(h);
    const c = log[i];
    const gap = i ? (ms(c.date) - ms(log[i - 1].date)) / 60e3 : Infinity;
    // Inicio de este commit: el anterior, si fue en la misma sesión (si no, no se sabe).
    return { hash: h, date: c.date, title: c.title, testeo: testeo.has(h), start: gap >= 0 && gap <= SESSION_GAP ? log[i - 1].date : null, files: c.files };
  }).sort((a, b) => ms(a.date) - ms(b.date));
  // Tramos de trabajo: commits seguidos (menos de 1 h entre uno y otro) en una sola barra.
  const tramos = [];
  for (const c of commits) {
    const s = c.start ?? local(ms(c.date) - 10 * 60e3);
    const last = tramos[tramos.length - 1];
    if (last && ms(s) - ms(last[1]) < 60 * 60e3) last[1] = c.date;
    else tramos.push([s, c.date]);
  }
  const lineas = {};
  for (const c of commits) for (const [f, n] of c.files) lineas[discipline(f)] = (lineas[discipline(f)] ?? 0) + n;
  return {
    ...e,
    estado: 'hecho',
    tipo: e.tipo ?? 'desarrollo',
    inicio: tramos[0][0],
    fin: commits[commits.length - 1].date,
    minutos: commits.reduce((a, c) => a + (c.start ? (ms(c.date) - ms(c.start)) / 60e3 : 0), 0),
    tramos,
    lineas,
    commits: commits.map(({ files, ...c }) => c),
  };
});

const sueltos = log.filter((c) => !used.has(c.hash) && !/^(Merge|Roadmap)/.test(c.title));
if (sueltos.length) console.warn('Commits sin entregable:\n' + sueltos.map((c) => `  ${c.hash} ${c.title}`).join('\n'));

writeFileSync(
  new URL('data.js', dir),
  `// Generado por tools/roadmap.mjs a partir de docs/roadmap/entregables.json y de git. No editar a mano.\nwindow.ROADMAP = ${JSON.stringify({ fases: def.fases, entregables, carpeta: def.carpeta })};\n`,
);
console.log(`docs/roadmap/data.js: ${entregables.length} entregables, ${used.size} commits`);
