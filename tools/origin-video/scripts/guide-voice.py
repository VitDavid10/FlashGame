# Voice-over for the "how to play" thread: one mp3 per post plus word timings.
#   python scripts/guide-voice.py
import asyncio, json, edge_tts

VOICE, RATE = 'en-US-AndrewNeural', '+6%'
SCENES = [
    ('move', "Your pill follows your mouse. On mobile, just drag your finger. Eat the food dots to grow, and remember: any pill smaller than you is food too."),
    ('hide', "Being hunted? Slip inside a virus. While you're smaller than it, nobody can eat you in there, and anything bigger that crashes into it bursts into pieces."),
    ('split', "Press space to split. Half of your pill shoots forward, so you can catch pills that are running away. Aim with your mouse, and split right on top of them."),
    ('skills', "Every thirty seconds you pick one of two skills. Fire them with the keys one to four. Shot pops viruses from far away, and sprint gets you out of trouble."),
    ('survive', "Run from anything bigger than you, clear your daily missions and bank airdrop points. Play now at pillwars dot fun."),
]

async def one(sid, text):
    com = edge_tts.Communicate(text, VOICE, rate=RATE, boundary='WordBoundary')
    words, audio = [], bytearray()
    async for ch in com.stream():
        if ch['type'] == 'audio': audio += ch['data']
        elif ch['type'] == 'WordBoundary':
            words.append({'t': ch['offset'] / 1e7, 'd': ch['duration'] / 1e7, 'w': ch['text']})
    open(f'public/guide/{sid}.mp3', 'wb').write(audio)
    return {'id': sid, 'text': text, 'words': words}

async def main():
    out = [await one(s, t) for s, t in SCENES]
    json.dump(out, open('public/guide/voice.json', 'w'), indent=1)
    for s in out: print(s['id'], round(s['words'][-1]['t'] + s['words'][-1]['d'], 2), 's')

asyncio.run(main())
