"""
Picks the liveliest stretch of every take in public/deaths/.

The video only keeps ~40 captured frames of each take (one beat of the music,
played at 1.6x). Taking the last ones sometimes landed on a lull: the pills had
already been eaten and nothing moved. This measures how much each frame changes
from the one before it and writes, per take, where its busiest window starts.

    python tools/origin-video/capture/pick-windows.py [window]

It adds "best" to every shot in public/deaths/events.json; src/Origin.tsx reads
it and falls back to the end of the take when it isn't there.
"""
import io
import json
import os
import sys

from PIL import Image, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, '..', 'public', 'deaths')
WINDOW = int(sys.argv[1]) if len(sys.argv) > 1 else 40
SMALL = (160, 90)


def frame(i):
    p = os.path.join(DIR, '%04d.jpg' % i)
    return Image.open(p).convert('L').resize(SMALL)


def main():
    meta_path = os.path.join(DIR, 'events.json')
    meta = json.load(io.open(meta_path, encoding='utf-8'))
    for shot in meta['shots']:
        n = shot['frames']
        # How much moves between one frame and the next.
        prev = frame(shot['from'])
        change = []
        for k in range(1, n):
            cur = frame(shot['from'] + k)
            diff = ImageChops.difference(prev, cur)
            change.append(sum(i * c for i, c in enumerate(diff.histogram())))
            prev = cur
        win = min(WINDOW, n - 1)
        # The first frames are the camera settling on the subject, and that jump
        # counted as more movement than anything the pills did afterwards.
        SKIP = min(8, max(0, n - 1 - win))
        best, score = SKIP, -1
        for start in range(SKIP, n - win):
            s = sum(change[start:start + win])
            if s > score:
                score, best = s, start
        shot['best'] = shot['from'] + best
        print('%-12s frames %3d  window %d  starts at +%d' % (shot['name'], n, win, best))
    io.open(meta_path, 'w', encoding='utf-8', newline='\n').write(json.dumps(meta, indent=2) + '\n')
    print('written', meta_path)


main()
