# My-Soso

A personal finance agent that lives in your chat app.

Sign up once, pick Telegram, Discord, or WhatsApp, and you get your own AI agent that watches the markets, tracks what you care about, and tells you what matters — without you ever opening another tab.

---

## Why this exists

Active crypto users today are forced to context-switch between price charts, news feeds, ETF flow trackers, and on-chain dashboards. The information is everywhere, and most of it is noise.

My-Soso compresses that whole workflow into the chat app you already check 50 times a day. Instead of 200 headlines, you see the 2 that affect your portfolio. Instead of "is BTC up or down?" panic-checking, you get a personal analyst that pings you only when something genuinely changes.

It's a bot, but it doesn't behave like one. It understands plain English ("why is ETH down today?", "alert me on big Solana news"), it remembers your watchlist, and it filters the firehose using AI — not keywords.

---

## What it does

- **Ask anything.** *"How are BTC ETF flows this week?"* → pulls flow data, summarizes the trend.
- **Track your watchlist.** Daily and weekly digests pushed automatically.
- **Smart alerts.** Price thresholds, ETF flow shifts, AI-filtered news that's actually about *your* assets.
- **Research on demand.** *"Give me a one-pager on Hyperliquid"* → returns a structured memo.
- **Index discovery.** Browse SoSoValue's on-chain indices; track them; (Wave 3) follow them.

It does **not** give buy/sell recommendations or move money in Wave 1. Execution and risk controls land in Wave 3, behind a confirm-to-execute UX and a compliance review.

---

## How it works (in 60 seconds)

```
User on Telegram/Discord/WhatsApp
            │
            ▼
       Edge service ─── verifies signature, rate-limits, queues
            │
            ▼
        Redis queue ─── BullMQ, hash-partitioned by conversation
            │
            ▼
       Worker service ─── runs the AI agent (Claude + tools)
            │              │
            │              ▼
            │       SoSoValue API ◀── cached and prefetched
            │              (we never hit it directly per-request)
            │
            ▼
   Outbound delivery to chat app
```

Four deployable services: **Dashboard** (Next.js), **API** (Fastify), **Edge** (chat ingress), **Worker** (AI agent + outbound delivery + scheduled jobs).

The agent is **channel-agnostic** — it doesn't know whether you're on Telegram, Discord, or WhatsApp. Adapters translate at the edges.

The single most important design decision is the **cache architecture**: SoSoValue's free tier allows ~10 requests/minute and ~10,000/month, so we never hit it on the user's hot path. A scheduled prefetcher keeps Redis warm with prices, news, indices, and ETF flows. ~95% of user queries hit cache and never touch the live API.

---

## Stack

Lean by design. Eight integrations, no ceremony.

| What | Why |
|---|---|
| **SoSoValue API** | Primary data source — prices, news, ETF flows, indices |
| **Anthropic Claude** | The LLM behind the agent (tool-calling) |
| **Privy** | Auth + email login + embedded wallet (also our Wave 3 signing layer) |
| **Telegram, Discord, WhatsApp** | Three channels, one shared agent |
| **Postgres on Supabase** | User data; Row-Level Security for tenant isolation |
| **Upstash Redis + BullMQ** | Job queue + warmed cache + rate-limit counters |
| **Railway** | Hosts all four services + dashboard |
| **Sentry** | Errors and basic performance |

End-to-end **TypeScript**. Monorepo via pnpm workspaces + Turborepo. Drizzle ORM. grammY for Telegram. discord-interactions for Discord. WhatsApp Business Cloud API directly.

## Getting Started

### 1. Prerequisites
- **Node.js** (>=22.0.0)
- **pnpm** (>=10.0.0)
- **Docker** (for local Redis)

### 2. Environment Setup
Copy `.env.example` to `.env` and fill in the required keys:
```bash
cp .env.example .env
```

### 3. Local Redis & Tunnel
The project uses Redis for queues. For Telegram/WhatsApp webhooks you also need a public tunnel (ngrok) so the platforms can reach your local Edge service.

**Start Redis:**
```bash
pnpm redis:up
```

**Start Tunnel (Required for Telegram/WhatsApp):**
In a separate terminal:
```bash
ngrok http 3002
```
The Edge service will automatically detect the ngrok URL and register it with Telegram on boot.

### 4. Install & Dev
```bash
pnpm install
pnpm dev
```

---

## Project structure

```
My-Soso/
├── README.md            ← you are here
├── plan.md              ← the 3-wave roadmap with tickable features
├── architecture.md      ← system design, data flow, cache strategy, security
└── adr/                 ← Architecture Decision Records
    ├── 0001-bullmq-over-kafka.md
    ├── 0002-discord-http-interactions-over-gateway.md
    ├── 0003-global-sosovalue-cache-with-prefetcher.md
    ├── 0004-turnkey-or-privy-for-wave-3-signing.md
    ├── 0005-hash-partitioned-queues-over-bullmq-groups.md
    └── 0006-provider-abstraction-with-sosovalue-primary.md
```

Code (apps + packages) gets added when we begin the build.

---

## Roadmap

Three waves, each independently demoable. If a later wave slips, earlier waves still ship.

### Wave 1 — Multi-channel advisory agent
Telegram + Discord + WhatsApp on day one. Q&A, watchlists, AI-filtered news alerts, daily digests, research memos. Powered entirely by SoSoValue. No execution.

### Wave 2 — AI signal layer + SoDEX read + SSI discovery
Opportunity discovery, news-to-signal extraction, weekly portfolio digests, sentiment alerts. SoDEX read APIs for orderbook/positions. SSI Protocol for on-chain index discovery. Richer chat UX (inline buttons, embeds, conversation memory).

### Wave 3 — On-chain execution
Confirm-to-execute SoDEX trades via Privy session keys. Per-user spending caps, daily limits, optional 2FA. SSI follow-index / auto-rebalance (stretch). Counsel review gate before launch.

Full feature checklists live in [`plan.md`](plan.md).

---

## Design principles

- **Lean stack.** Eight integrations, one language, two databases. Anything more must earn its place.
- **Channel-agnostic core.** The agent never knows which chat app the user is on; adapters handle that at the edges.
- **Cache-first.** SoSoValue is the heart of the product, but the hot path never hits it directly. Prefetcher + Redis + monthly budget tracker keep us under quota and fast.
- **Custody-light.** We don't hold private keys. Ever. Privy's enclave does the signing in Wave 3.
- **Tenant isolation at the database.** Postgres RLS, not just app-layer checks.
- **Compliance-aware.** Every response is classified; recommendations are hard-blocked in Wave 1; execution gated behind counsel review.
- **Observable from day one.** Structured logs, Sentry, one dashboard the team checks every morning.

---

## Status

**Wave 1 / Phases 1–4 complete; Phase 5 in progress.** Telegram/Discord/WhatsApp are wired through Edge → Redis → Worker with SoSoValue-backed answers, watchlists, alerts, and digests. Discord supports both slash commands and “normal DM chat” via a Gateway listener (Message Content Intent required).

Read [`architecture.md`](architecture.md) before writing code. Update it before changing something it describes.
