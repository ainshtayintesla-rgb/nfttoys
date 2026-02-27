# 🚀 Platform Antigravity

> NFT Collectible Toys Management Platform with Telegram Mini App Integration

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Self--hosted-336791?logo=postgresql)](https://www.postgresql.org/)
[![Telegram](https://img.shields.io/badge/Telegram-Mini_App-26A5E4?logo=telegram)](https://core.telegram.org/bots/webapps)

## ✨ Features

### 🎮 NFT Collectible Management
- **Animated 3D Models** — Lottie/TGS animations for each collectible
- **Rarity System** — Common, Rare, and Legendary tiers
- **Unique Serial Numbers** — Global uniqueness across all models

### 🔐 Secure QR Code System
- **Server-side Token Generation** — HMAC-SHA256 signed tokens
- **One-time Activation** — Each QR code can only be used once
- **Admin Panel** — Full CRUD operations for QR code management

### 📱 Telegram Integration
- **Auto-authentication** — Seamless login via Telegram Mini App
- **User Data Sync** — Profile photos, names, language preferences
- **Local JWT Auth** — Backend-issued secure session tokens

### 🌍 Internationalization
- **3 Languages** — English, Russian, Uzbek
- **Auto-detection** — Uses Telegram user's language preference

## 🛠 Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 15 (App Router) |
| Database | Self-hosted PostgreSQL |
| Auth | Local JWT + Telegram initData |
| Styling | CSS Modules |
| Animations | Lottie / TGS Player |
| Language | TypeScript |

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL
- Telegram Bot Token

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/platform-antigravity.git
cd platform-antigravity

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start development server
npm run dev
```

### Environment Variables

```env
# Telegram
TELEGRAM_BOT_TOKEN=

# Security
TOKEN_SECRET=your-32-char-secret-key
JWT_SECRET=your-32-char-secret-key
JWT_EXPIRES_IN=7d
```

## 📁 Project Structure

```
src/
├── app/
│   ├── admin/         # Admin panel
│   ├── activate/      # QR activation page
│   ├── profile/       # User profile
│   ├── scan/          # QR scanner
│   └── api/           # API routes
├── components/
│   ├── layout/        # Header, Navigation
│   ├── features/      # ToyCard, TransferModal
│   └── ui/            # Button, etc.
├── lib/
│   ├── context/       # React contexts
│   ├── auth.ts        # JWT session helpers
│   ├── data/          # Static data
│   └── i18n.ts        # Translations
└── public/
    └── animations/    # TGS/Lottie files
```

## 📜 License

This project is licensed under the Apache License 2.0 — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Made with ❤️ by <a href="https://t.me/yourusername">Your Name</a>
</p>


settings
who used activasion code
send nft modal
tg bot start?activasion_code
