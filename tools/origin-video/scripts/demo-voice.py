# Voice-over for the Demo video: one mp3 per line and its length (the subtitles show each line whole).
#   PIPER_MODEL=<path to en_US-ryan-high.onnx> python scripts/demo-voice.py
# Piper (offline neural TTS, https://github.com/rhasspy/piper) and not edge-tts like the other
# videos: since October 2026 Microsoft's read-aloud endpoint answers 403 to edge-tts.
# Voice models: https://huggingface.co/rhasspy/piper-voices (en/en_US/ryan/high).
import json, os, subprocess, wave
from piper import PiperVoice, SynthesisConfig

MODEL = os.environ['PIPER_MODEL']
# (id, what is said, what the subtitles show: TTS reads "$PILLY" badly)
LINES = [
    ('intro', "This is PillWars. Real-time pill battles, where every kill pays.", None),
    ('duel', "Pick a duel, pay your entry in Pilly tokens, and fight.", "Pick a duel, pay your entry in $PILLY, and fight."),
    ('win', "Win, and the whole pot is yours.", None),
    ('friends', "Add a friend, make a group, and go two versus two.", "Add a friend, make a group, and go 2v2."),
    ('menus', "Skins, guides, and daily quests. Pick three to track while you play.", None),
    ('classic', "In Classic, every kill takes your rival's tokens.", None),
    ('penta', "Five kills is a Pentakill. You leave with everything.", None),
    ('mobile', "And the whole game fits in your pocket, on Solana Mobile.", None),
    ('outro', "PillWars. See you in the arena.", None),
]
OUT = 'public/demo/voice'

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
