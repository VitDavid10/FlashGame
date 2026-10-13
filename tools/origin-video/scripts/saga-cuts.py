# Cuts the clips of the "SeekerPlus" video out of the recordings of the Saga (public/saga/*.mp4,
# recorded with adb screenrecord: variable frame rate) into constant 30 fps pieces, one per row of
# public/saga/plus.json, plus the hub still shown while the phone turns.
#   python scripts/saga-cuts.py
import json, subprocess, os
BEAT = 60 / 105
D = 'public/saga'
rows = json.load(open(f'{D}/plus.json'))
os.makedirs(f'{D}/cuts', exist_ok=True)
for i, r in enumerate(rows):
    dur = r['beats'] * BEAT + 0.25
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(r['t']), '-i', f"{D}/{r['src']}", '-t', f'{dur:.3f}',
                    '-vf', 'fps=30,scale=1920:864:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '17', '-preset', 'fast', '-an', f'{D}/cuts/{i}.mp4'], check=True)
    print(i, r['src'], r['t'], f'{dur:.2f}s')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '51.8', '-i', f'{D}/rec1.mp4', '-frames:v', '1', '-vf', 'scale=1920:864', f'{D}/hub.jpg'], check=True)
