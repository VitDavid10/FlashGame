// Original track for the Airdrop video, synthesised from scratch (no samples):
// chiptune-electro at 120 BPM, so a beat is exactly 15 frames at 30 fps and
// every cut of src/Airdrop.tsx lands on a beat. Writes public/snd/airdrop-music.wav.
//   node scripts/airdrop-music.mjs
import { writeFileSync } from "node:fs";

const SR = 44100, BPM = 120, SPB = 60 / BPM; // seconds per beat
const BEATS = 44, LEN = BEATS * SPB + 1.5;    // 22 s + tail
const N = Math.ceil(LEN * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const K = new Float32Array(N); // kick bus, kept out of the sidechain
const t2s = (beat) => Math.round(beat * SPB * SR);
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Cuts of the video, in beats (Airdrop.tsx CUTS / 15): a soft cymbal on each.
const CUTS = [10, 19, 27, 40];
const DROP = 4; // the groove kicks in with "$PILLY"
const kicks = [];

let seed = 1;
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31) - 1;
const add = (i, l, r = l) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };

function kick(b, amp = 0.9) {
  kicks.push(t2s(b));
  const s0 = t2s(b), n = Math.round(0.4 * SR);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = 45 + 110 * Math.exp(-t * 28);
    ph += (2 * Math.PI * f) / SR;
    const v = Math.sin(ph) * Math.exp(-t * 7) * amp + (i < 60 ? noise() * 0.3 * (1 - i / 60) : 0);
    if (s0 + i < N) K[s0 + i] += v;
  }
}
function clap(b, amp = 0.35) {
  const s0 = t2s(b), n = Math.round(0.25 * SR);
  let lp = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // three quick bursts then the tail, like a hand clap
    const env = t < 0.03 ? Math.exp(-((t * 1000) % 10) / 3) : Math.exp(-(t - 0.03) * 18);
    const x = noise(); lp += 0.35 * (x - lp); const bp = lp - prev; prev = lp;
    add(s0 + i, bp * env * amp * 2.2, bp * env * amp * 2.0);
  }
}
function hat(b, amp = 0.12, open = false) {
  const s0 = t2s(b), n = Math.round((open ? 0.22 : 0.05) * SR);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const x = noise(), hp = x - prev; prev = x;
    const e = Math.exp(-(i / SR) * (open ? 14 : 70));
    add(s0 + i, hp * e * amp * 0.8, hp * e * amp);
  }
}
function crash(b, amp = 0.28) {
  const s0 = t2s(b), n = Math.round(1.8 * SR);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const x = noise(), hp = x - prev; prev = x;
    const e = Math.exp(-(i / SR) * 2.4);
    add(s0 + i, hp * e * amp, noise() * e * amp * 0.5 + hp * e * amp * 0.5);
  }
}
/** Square/saw voice with an ADSR-ish envelope and a one-pole low-pass. */
function tone(b, beats, midi, { amp = 0.1, wave = "sq", cut = 3000, dec = 6, pan = 0, duty = 0.5, det = 0 } = {}) {
  const s0 = t2s(b), n = Math.round(beats * SPB * SR);
  const f = hz(midi), a = 1 - Math.exp((-2 * Math.PI * cut) / SR);
  let lp = 0;
  for (let i = 0; i < n + 800; i++) {
    const t = i / SR;
    const env = Math.min(1, i / 60) * Math.exp(-t * dec) * (i < n ? 1 : 1 - (i - n) / 800);
    let x = 0;
    for (const d of det ? [-det, det] : [0]) {
      const ph = (t * f * (1 + d)) % 1;
      x += wave === "sq" ? (ph < duty ? 1 : -1) : 2 * ph - 1;
    }
    lp += a * (x - lp);
    add(s0 + i, lp * env * amp * (1 - pan), lp * env * amp * (1 + pan));
  }
}

// A minor: Am – F – C – G, one chord per bar.
const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const ARP = [0, 1, 2, 3, 2, 1, 3, 4, 0, 2, 1, 3, 2, 4, 3, 1];
const tones = (c) => [c[0], c[1], c[2], c[0] + 12, c[1] + 12];

for (let b = 0; b < BEATS; b++) {
  const chord = PROG[Math.floor(b / 4) % 4];
  const full = b >= DROP;
  const bar = b % 4;
  // pad on each bar
  if (bar === 0) for (const m of chord) tone(b, 4, m, { amp: full ? 0.05 : 0.07, wave: "saw", cut: full ? 1400 : 700, dec: 0.3, det: 0.006 });
  // arp: 16ths, filtered in the intro, opening up on the drop
  for (let s = 0; s < 4; s++) {
    const m = tones(chord)[ARP[(bar * 4 + s) % 16]] + 12;
    const cut = full ? 5000 : 900 + 900 * (b + s / 4);
    tone(b + s / 4, 0.22, m, { amp: 0.075, cut, dec: 9, duty: 0.25, pan: s % 2 ? 0.35 : -0.35 });
    // echo 3/16 later, quieter, on the other side
    tone(b + s / 4 + 0.75, 0.22, m, { amp: 0.03, cut: cut * 0.6, dec: 9, duty: 0.25, pan: s % 2 ? -0.5 : 0.5 });
  }
  if (!full) { hat(b + 0.5, 0.06); continue; }
  // drums
  kick(b);
  if (bar === 1 || bar === 3) clap(b);
  for (let s = 0; s < 4; s++) hat(b + s / 4, s === 2 ? 0.1 : 0.06, s === 2);
  // rolling bass: root on the off-8ths, octave pop on the last 16th
  const root = chord[0] - 24;
  tone(b + 0.5, 0.45, root, { amp: 0.2, wave: "saw", cut: 700, dec: 3 });
  tone(b + 0.75, 0.2, root + 12, { amp: 0.12, wave: "saw", cut: 900, dec: 8 });
  // lead hook on bars 2 and 4 of each phrase
  if (b >= 8 && bar === 0 && Math.floor(b / 4) % 2 === 1) {
    const top = chord[2] + 12;
    [[0, top], [0.5, top + 2], [1, top + 3], [1.75, top + 2], [2.5, top], [3, top - 2]]
      .forEach(([o, m]) => tone(b + o, 0.45, m, { amp: 0.07, cut: 3500, dec: 3, duty: 0.5, pan: 0 }));
  }
}
// a soft cymbal on each cut, big entry on the drop, final hit
crash(DROP, 0.15);
for (const c of CUTS) crash(c, 0.12);
kick(BEATS, 1); crash(BEATS, 0.15);
for (const m of PROG[0]) tone(BEATS, 3, m, { amp: 0.06, wave: "saw", cut: 1800, dec: 1.2, det: 0.006 });

// sidechain: everything but the kick ducks on each kick, then the kick goes on top
kicks.sort((a, b) => a - b);
let k = 0;
for (let i = 0; i < N; i++) {
  while (k + 1 < kicks.length && kicks[k + 1] <= i) k++;
  const d = kicks.length && i >= kicks[k] ? (i - kicks[k]) / SR : 1;
  const g = 0.55 + 0.45 * Math.min(1, d / 0.16);
  L[i] = L[i] * g + K[i]; R[i] = R[i] * g + K[i];
}

// master: normalise, soft clip, 16-bit stereo WAV
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVEfmt ", 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
const gain = 1.4 / peak;
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.tanh(L[i] * gain) * 0.89 * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.tanh(R[i] * gain) * 0.89 * 32767), 46 + i * 4);
}
writeFileSync(new URL("../public/snd/airdrop-music.wav", import.meta.url), buf);
console.log(`airdrop-music.wav: ${LEN.toFixed(1)} s, ${BPM} BPM`);
