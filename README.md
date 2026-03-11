# NFToys

> Making NFT ownership simple, familiar, and rewarding — starting from Uzbekistan.

NFToys is a Telegram Mini App platform that bridges mainstream users and blockchain-based ownership through physical NFC-linked cards, a frictionless onboarding flow, and a staking ecosystem tied to a future token launch.

---

## The Problem

Most NFT platforms assume users already understand wallets, seed phrases, and gas fees. In Uzbekistan — and across Central Asia — this creates a hard wall: people who would genuinely benefit from digital ownership simply never get past onboarding.

At the same time, Telegram is deeply embedded in daily life here. It's where people message, buy, sell, and discover products. The gap between "interested in NFTs" and "actually owns one" is almost entirely a UX problem.

---

## The Solution

NFToys removes that wall by tying activation to a physical card — something users already hold, touch, and trust.

**How it works:**

1. A user receives or purchases a physical card (NFC-linked or QR-coded).
2. They tap or scan it — no app installation required.
3. They are redirected into a Telegram Mini App, a surface that feels native to them.
4. The NFT is activated and associated with their Telegram identity.
5. From that point on, they own a digital asset — without ever setting up a wallet manually.

---

## NFT Rarity System

Each physical card looks similar, but the NFT received can vary by rarity tier, adding a collectible and gamification layer:

| Rarity    | Description                             | Staking Reward |
|-----------|-----------------------------------------|----------------|
| Common    | Standard edition, widely distributed   | 30 UZS/hour    |
| Rare      | Limited print, harder to obtain         | 60 UZS/hour    |
| Legendary | Exclusive, very low supply              | 120 UZS/hour   |

Rarity is determined at activation time and is permanently embedded in the NFT metadata.

---

## NFT Staking

NFT holders can stake their assets inside the Telegram Mini App to earn passive rewards in UZS (the in-app asset, later bridgeable to LVE tokens).

**Staking mechanics:**
- Stake any NFT you own within the staking window (24–48 hours after receiving it).
- Rewards accumulate per hour based on rarity tier.
- Claim rewards at any time; unstake after the cooldown period.
- **Story Share Boost**: share your staked NFT as a Telegram Story to earn a +40% reward multiplier for 3 days — verified automatically by the platform.

---

## Wallet Approaches

NFToys is being built around two wallet strategies, designed for different stages of user maturity:

### Lightweight Wallet (Telegram-native)
- Zero setup friction — tied to the user's Telegram identity.
- Receive, view, and stake NFTs without leaving the Mini App.
- Ideal for first-time users or casual collectors.

### Advanced Wallet (Wallet V2)
- Full recovery phrase support — true self-custody.
- Biometric authentication for quick access.
- NFT staking, balance tracking, and transaction history.
- Designed to be independent of Telegram in the future.

Users can start with the lightweight wallet and migrate to the advanced wallet as their confidence and needs grow.

---

## Ecosystem & Token Strategy

NFToys is the pre-launch audience layer for **Lvenc (LVE)** — a blockchain ecosystem being built for Central Asia.

The strategy is deliberate:
- Build a real user base around a tangible product (collectible NFTs) before any token exists.
- Let users earn, stake, and understand value flows inside the ecosystem first.
- When Lvenc launches, the community already has product experience, earned balances, and a reason to participate.

In-app rewards are denominated in UZS (Uzbekistani Som equivalent units) during the pre-launch phase and will be convertible to LVE tokens at launch.

---

## Tech Stack

| Layer      | Technology                                      |
|------------|-------------------------------------------------|
| Backend    | Node.js, Express, TypeScript, Prisma ORM        |
| Frontend   | Next.js 14, React, TypeScript, CSS Modules      |
| Database   | PostgreSQL                                      |
| Auth       | Telegram Web App auth, JWT sessions, biometrics |
| Animation  | Lottie / TGS (Telegram animated stickers)       |
| Deployment | Docker, k3s (Kubernetes), GitHub Actions CI/CD  |

---

## Roadmap

### Now (Pre-launch)
- [x] NFC/QR card activation flow
- [x] Telegram Mini App integration
- [x] NFT rarity system (common, rare, legendary)
- [x] NFT staking with per-rarity reward rates
- [x] Story Share boost mechanism
- [x] Lightweight wallet (Telegram-native)
- [x] Advanced Wallet V2 with recovery phrase and biometrics

### Near-term
- [ ] Expand physical card distribution across Uzbekistan
- [ ] Leaderboard and collector rankings
- [ ] NFT transfer between wallets
- [ ] Marketplace for peer-to-peer NFT trading

### Long-term
- [ ] Lvenc (LVE) token launch and UZS → LVE conversion
- [ ] Full wallet independence from Telegram
- [ ] Multi-chain NFT support
- [ ] Regional expansion across Central Asia

---

## Local Development

See [`README.DOCKER.md`](./README.DOCKER.md) for Docker-based setup instructions.

```bash
# Backend
cd server && npm install && npx prisma migrate dev && npm run dev

# Frontend
cd client && npm install && npm run dev
```

---

## License

Private — all rights reserved. NFToys / Lvenc project.
