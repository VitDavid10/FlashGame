# PillWars Airdrop — how points work

The end date of Season 0 will be announced. The $PILLY airdrop (10% of the supply) is split
in proportion to each player's points.

## 1. Solana wallet (on-chain)

| Category | Max points | How |
|---|---|---|
| Airdrop Hunter | 11,000 | Tiers by Solana airdrops the wallet qualified for |
| Saga / Seeker Genesis Token | 10,000 | Holding a Saga or Seeker Genesis Token (either one, not both) |
| Mad Lads | 10,000 | Holding a Mad Lads NFT |
| Wallet age | 2,400 | Tiers by days since the wallet's first transaction |
| Transactions | 2,400 | Tiers by successful transactions |

**Airdrop Hunter** — a wallet qualifies for a project when its account for that
project's token shows a transaction on or before the project's own claim
deadline (a date on the blockchain can't be faked by buying the token today).
Checked live on mainnet by the server (`server/airdrop-tokens.js`):

| Airdrop | Deadline used | Source |
|---|---|---|
| Jito (JTO) | 7 Jun 2025 (18 months after the 7 Dec 2023 TGE) | [jito.network](https://www.jito.network/blog/airdrop-claiming-details/) |
| Pyth (PYTH) | 20 Feb 2024 | [pyth.network](https://www.pyth.network/blog/pyth-network-retrospective-airdrop-eligibility-and-distribution-specifications) |
| Wormhole (W) | 2 Jul 2024 (90 days after the ~3 Apr 2024 launch) | [wormhole.com](https://wormhole.com/blog/w-airdrop-explained) |
| Tensor (TNSR) | 5 Oct 2024 | [solanafloor.com](https://solanafloor.com/news/solanas-top-nft-marketplace-tensor-launches-airdrop-claim-and-tnsr-token-trading) |
| Drift (DRIFT) | 14 Nov 2025 (final extended deadline) | [drift.trade](https://www.drift.trade/governance/claims-for-the-drift-governance-token-are-now-live) |
| Magic Eden (ME) | 1 Feb 2025 | [solanafloor.com](https://solanafloor.com/news/magic-eden-debuts-token-with-airdrop-claimable-only-via-mobile-app) |
| Meteora (MET) | 23 Jan 2026 | [docs.meteora.ag](https://docs.meteora.ag/protocol/met/faq) |
| BONK | 1 Feb 2023 (distributed directly on 25 Dec 2022, no claim step) | [bitdegree.org](https://www.bitdegree.org/crypto/tutorials/bonk-token-airdrop) |
| Sanctum (CLOUD) | 14 Apr 2025 | [phantom.com](https://phantom.com/learn/crypto-101/sanctum-cloud-airdrop) |
| Grass (GRASS), season 1 only | 27 Mar 2025 | [coingabbar.com](https://www.coingabbar.com/en/crypto-currency-news/grass-airdrop-claim-period-extended-check-grass-claim-details) |

**Jumper (1,000+ XP)** — checked live against a third-party site
(`jumper-jade.vercel.app`, not run by Jumper Exchange itself; there is no
official public API for this) that reports a Solana wallet's Jumper XP. If
that site is unreachable the wallet just doesn't get the points this check —
never a false yes (`server/airdrop-jumper.js`).

**Jupiter (JUP)** and **Kamino (KMNO)** are not in the list: both are ongoing,
season-based programs with no fixed snapshot or deadline, so there is no way
to tell "qualified in a past round" from "bought the token yesterday". Also
dropped: **Jupiter Jupuary** (not a distinct airdrop, just another JUP round).

| Airdrops | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7+ |
|---|---|---|---|---|---|---|---|---|
| Share | 0% | 20% | 35% | 50% | 65% | 80% | 90% | 100% |
| Points | 0 | 2,200 | 3,850 | 5,500 | 7,150 | 8,800 | 9,900 | 11,000 |

With 10 real airdrops checked today (Jupiter pending), the "7+" tier is the
highest anyone can reach — nobody gets a 100% no one else could also reach.


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

## 3. Invites (max 15,000)

An invite counts when the invited person links a Solana wallet **at least 60 days old
with at least 50 transactions**. Linking only X does not count. Nobody can invite
themselves, each person counts once, and only the first 50 invites pay.

| Invites | 1 | 3 | 5 | 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45 | 50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Points | 500 | 700 | 1,000 | 1,300 | 1,300 | 1,300 | 1,300 | 1,300 | 1,300 | 1,300 | 1,300 | 2,400 |

Your invite link (`?ref=`) and every card link you share (`/c/...`) count the same.

## 4. Daily Arena (up to 600 a day)

Five missions a day, one per level, rotating daily. Progress does not reset with TRY AGAIN.

| Level | Points |
|---|---|
| Easy | 40 |
| Medium | 120 |
| Hard | 260 |
| Skill | 90 |
| Grind | 90 |

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
- *Airdrops, Genesis Tokens, Mad Lads and Jumper XP are all real (server/airdrop-tokens.js, server/airdrop-nfts.js, server/airdrop-jumper.js).*
- *Quest, arena and share points are now computed and stored on the server (server/airdrop-score.js), not in the browser - editing localStorage has no lasting effect. Still trusted from the client: that a repost/like/follow actually happened (X isn't re-checked), and a match's `finished`/`place` outcome (the offline arena has no server-run simulation to verify it against).*
- *Pending: max 0.5% of the supply per person.*
- *Source of truth in code: `airdrop.html` (tiers, quests) and `server/airdrop-store.js` (invite rule).*
