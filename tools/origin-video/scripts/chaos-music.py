# Music for the Chaos video (src/Chaos.tsx), made from a song the user downloads
# (not in the repo): its section from 1:00, reworked so it isn't the same track
# but keeps its beat. 180 BPM, first strong beat at 0.671 s: a beat is exactly
# 10 frames at 30 fps, so every cut of the video lands on one.
#   - pitch up 2 semitones, tempo untouched (ffmpeg rubberband)
#   - different EQ: thinner lows, brighter top, a touch of crush
#   - beat-repeat stutters on the beats that lead into each text card (STUTTER)
# Writes public/snd/chaos-music.wav (git-ignored: it's still derived from the song).
#   python scripts/chaos-music.py "<song.mp3>"
import subprocess, sys, os, numpy as np

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'snd', 'chaos-music.wav')
SR, FROM, LEN = 44100, 60.0, 29.35
BEAT = 1 / 3            # 180 BPM
FIRST = 0.3380          # first beat after FROM (strong beats are the odd ones)

# Beats (index from FIRST) whose second half is replaced by 1/32-note repeats:
# the beat right before each text card of Chaos.tsx (cards at frames 0, 160,
# 320, 460, 620; beat k sits at frame 10k + 10).
STUTTER = [14, 30, 44, 60]

raw = subprocess.run([
    'ffmpeg', '-v', 'error', '-ss', str(FROM), '-t', str(LEN), '-i', SRC,
    '-af', 'rubberband=pitch=1.122462:transients=crisp,'
           'highpass=f=45,equalizer=f=110:t=q:w=1:g=-4,equalizer=f=3200:t=q:w=1.2:g=3,'
           'acrusher=bits=12:mix=0.18:mode=log,aecho=0.8:0.5:60:0.12',
    '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
x = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()

def s(t): return int(round(t * SR))
for k in STUTTER:
    t0 = FIRST + k * BEAT
    half = BEAT / 2
    seg = x[s(t0):s(t0 + half / 2)].copy()
    n = len(seg)
    fade = np.linspace(1, 0, n)[:, None] ** 0.3   # each repeat gated
    for i in range(4):                             # 4 x 1/32 fill the beat's second half
        a = s(t0 + half) + i * n // 2
        b = min(a + n // 2, len(x))
        x[a:b] = (seg[:b - a] * fade[:b - a]) * (0.9 + 0.05 * i)
fade = np.ones(len(x)); nf = s(1.5); fade[-nf:] = np.linspace(1, 0, nf)
x *= fade[:, None]
x *= 0.95 / np.abs(x).max()      # the filters leave it ~15 dB down: back to full level
pcm = (x * 32767).astype('<i2').tobytes()
import wave
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm)
print('wrote', OUT, len(x) / SR, 's')
