# Voice-over for the Modes video (src/Modes.tsx), same voice as the Demo one: one mp3 per line and its length.
#   PIPER_MODEL=<path to en_US-ryan-high.onnx> python scripts/modes-voice.py
import json, os, subprocess, wave
from piper import PiperVoice, SynthesisConfig

MODEL = os.environ['PIPER_MODEL']
# (id, what is said, what the subtitles show when it differs)
LINES = [
    ('intro', "PillWars has two ways to play.", None),
    ('classic', "Classic: pick a room and jump in with everyone online. Every kill takes your rival's tokens.", None),
    ('arenas', "Not enough players around? Open Arenas, a separate menu for smaller matches.", None),
    ('teams', "One versus one, two versus two, or three versus three. Just your squad against theirs.", "1v1, 2v2 or 3v3. Just your squad against theirs."),
    ('outro', "Two modes. Pick yours.", None),
]
OUT = 'public/modes'

def main():
    os.makedirs(OUT, exist_ok=True)
    voice = PiperVoice.load(MODEL)
    cfg = SynthesisConfig(length_scale=0.92, noise_scale=0.6, noise_w_scale=0.7)
    out = []
    for sid, text, sub in LINES:
        wav = f'{OUT}/{sid}.wav'
        with wave.open(wav, 'wb') as wf:
            voice.synthesize_wav(text, wf, syn_config=cfg)
        with wave.open(wav, 'rb') as wf:
            secs = wf.getnframes() / wf.getframerate()
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-af', 'highpass=f=70,loudnorm=I=-16:TP=-1.5', '-ar', '44100', '-b:a', '160k', f'{OUT}/{sid}.mp3'], check=True)
        os.remove(wav)
        out.append({'id': sid, 'text': sub or text, 'len': round(secs, 2)})
        print(sid, round(secs, 2), 's')
    json.dump(out, open(f'{OUT}/voice.json', 'w'), indent=1)

main()
