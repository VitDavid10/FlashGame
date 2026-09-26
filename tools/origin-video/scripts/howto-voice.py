# Voice-over for the HowTo video: one mp3 per scene plus word timings for the subtitles.
#   python scripts/howto-voice.py
import asyncio, json, edge_tts

VOICE, RATE = 'en-US-AndrewNeural', '+6%'
# (id, what is said, what the subtitles show when it differs: TTS reads "$PILLY" badly)
SCENES = [
    ('intro', "This is the PillWars Genesis Drop. Here's how to join the Pilly airdrop, step by step."),
    ('x', "Step one: connect your X account. Your followers and account age turn into points."),
    ('wallet', "Step two: add your Solana wallet. Connecting only asks for a signature, so nothing ever leaves your wallet. Or skip that, and just paste your address."),
    ('card', "Your wallet's history, its age, activity and past airdrops, earns you even more points. Your card shows your total, and your rank."),
    ('boost', "Now, the most important part: the four boost quests. Follow us on X, join the Telegram, play your first match, and claim the Genesis Hunter role on Discord. Complete all four, and every point you have is multiplied by one point five. Don't skip them."),
    ('arena', "Scroll down to the Daily Arena. Play the game and clear the daily missions to bank extra points, every single day."),
    ('game', "Want to know more about the game itself? Open The Game tab, it's full of useful info. Or, if you'd rather not read, stay tuned for more videos like this one."),
    ('outro', "pillwars dot fun. See you in the arena."),
]

async def one(sid, text):
    com = edge_tts.Communicate(text, VOICE, rate=RATE, boundary='WordBoundary')
    words, audio = [], bytearray()
    async for ch in com.stream():
        if ch['type'] == 'audio': audio += ch['data']
        elif ch['type'] == 'WordBoundary':
            words.append({'t': ch['offset'] / 1e7, 'd': ch['duration'] / 1e7, 'w': ch['text']})
    open(f'public/howto/{sid}.mp3', 'wb').write(audio)
    return {'id': sid, 'text': text, 'words': words}

async def main():
    out = [await one(s, t) for s, t in SCENES]
    json.dump(out, open('public/howto/voice.json', 'w'), indent=1)
    for s in out: print(s['id'], round(s['words'][-1]['t'] + s['words'][-1]['d'], 2), 's')

asyncio.run(main())
