# PillWars Airdrop — how points work

Season 0 ends on 20 October 2026. The $PILLY airdrop (10% of the supply) is split
in proportion to each player's points.

## 1. Solana wallet (on-chain)

| Category | Max points | How |
|---|---|---|
| Airdrop Hunter | 11,000 | Tiers by Solana airdrops the wallet qualified for |
| NFT Holder | 4,800 | Saga or Seeker Genesis Token 2,400 + Mad Lads 2,400 |
| Wallet age | 2,400 | Tiers by days since the wallet's first transaction |
| Transactions | 2,400 | Tiers by successful transactions |

**Airdrop Hunter** — airdrops counted (14): Jupiter (JUP), Jupiter Jupuary, Jito (JTO),
Pyth (PYTH), Wormhole (W), Tensor (TNSR), Kamino (KMNO), Drift (DRIFT), Magic Eden (ME),
Meteora (MET), BONK, Sanctum (CLOUD), Grass (GRASS), Jumper points.

| Airdrops | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7+ |
|---|---|---|---|---|---|---|---|---|
| Share | 0% | 20% | 35% | 50% | 65% | 80% | 90% | 100% |
| Points | 0 | 2,200 | 3,850 | 5,500 | 7,150 | 8,800 | 9,900 | 11,000 |

**NFT Holder**

| NFT | Points |
|---|---|
| Saga Genesis Token **or** Seeker Genesis Token (holding both still pays once) | 2,400 |
| Mad Lads (verified collection) | 2,400 |

Each NFT (and each Genesis Token) counts for one wallet only: the first wallet that
shows it. Moving an NFT to another wallet earns nothing more.

**Transactions**

| Transactions | < 50 | 50+ | 200+ | 500+ | 1,000+ | 2,500+ | 5,000+ |
|---|---|---|---|---|---|---|---|
| Share | 0% | 10% | 25% | 40% | 60% | 80% | 100% |
| Points | 0 | 240 | 600 | 960 | 1,440 | 1,920 | 2,400 |

**Wallet age**

| Age | < 30 days | 30+ days | 90+ days | 180+ days | 1+ year | 2+ years | 3+ years |
|---|---|---|---|---|---|---|---|
| Share | 0% | 10% | 25% | 40% | 60% | 80% | 100% |
| Points | 0 | 240 | 600 | 960 | 1,440 | 1,920 | 2,400 |

Wallet data is read from Solana mainnet by our server and refreshed once a day.

## 2. X account (max 4,000)

| Line | Points |
|---|---|
| Followers | √followers × 14, up to 2,500 |
| Account age | 100 per year, up to 1,200 |
| Verified account | 300 |

## 3. Invites (max 8,000)

An invite counts when the invited person links a Solana wallet **at least 60 days old
with at least 50 transactions**. Linking only X does not count. Nobody can invite
themselves, each person counts once, and only the first 50 invites pay.

| Invites | 1 | 3 | 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Points | 250 | 350 | 500 | 700 | 700 | 700 | 700 | 700 | 700 | 700 | 700 | 1,300 |

Your invite link (`?ref=`) and every card link you share (`/c/...`) count the same.

## 4. Daily Arena (up to 300 a day)

Five missions a day, one per level, rotating daily. Progress does not reset with TRY AGAIN.

| Level | Points |
|---|---|
| Easy | 20 |
| Medium | 60 |
| Hard | 130 |
| Skill | 45 |
| Grind | 45 |

## 5. Social quests

| Quest | Points |
|---|---|
| Daily post about PillWars | 100, once a day |
| Share your points card | 400; available again when your points grow 10% past your last share |
| Share a match card | 30, once a day |
| Repost of an official post | 150 per post |
| Like of an official post | 50 per post |

## 6. One-time boost

Follow @pillwarsdotfun, join the Telegram and play your first match. These give no points
by themselves, but finishing all three **multiplies all your points ×1.5**, past and future.

---

*Internal, do not share:*
- *Airdrops and Jumper points are still sample data on the page: they must be verified for real (published eligibility lists or on-chain claims) before launch. Genesis Tokens and Mad Lads are real (server/airdrop-nfts.js).*
- *Quest, arena and share points are still computed in the browser: they must move to the server before launch.*
- *Pending: max 0.5% of the supply per person.*
- *Source of truth in code: `airdrop.html` (tiers, quests) and `server/airdrop-store.js` (invite rule).*
