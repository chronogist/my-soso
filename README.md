# My-Soso

A signal-to-execution personal finance agent that lives in your chat app.

Sign up once, pick Telegram, Discord, or WhatsApp, and you get your own AI agent that watches the markets, tracks what you care about, and tells you what matters — without you ever opening another tab.

---

## Why this exists

Active crypto users today are forced to context-switch between price charts, news feeds, ETF flow trackers, and on-chain dashboards. The information is everywhere, and most of it is noise.

My-Soso compresses that whole workflow into the chat app you already check 50 times a day. Instead of 200 headlines, you see the 2 that affect your portfolio. Instead of "is BTC up or down?" panic-checking, you get a personal analyst that pings you only when something genuinely changes.

It's a bot, but it doesn't behave like one. It understands plain English ("why is ETH down today?", "alert me on big Solana news"), it remembers your watchlist, and it turns noisy market data into discussion-ready signals today, with execution workflows planned as the product matures.

---

## What it does

- **Signal-rich discussion.** *"How are BTC ETF flows this week?"* → pulls flow data, summarizes the trend, and frames what matters.
- **Track your watchlist.** Daily and weekly digests pushed automatically.
- **Smart alerts.** Price thresholds, ETF flow shifts, AI-filtered news that's actually about *your* assets.
- **Research on demand.** *"Give me a one-pager on Hyperliquid"* → returns a structured memo.
- **Signal to execution roadmap.** Today: discussion, watchlists, alerts, digests, and research powered by SoSoValue. Later phases: follow-through into guided, confirmed trade execution.

Today, MySoSo is focused on discussion, signals, watchlists, alerts, and market context powered by SoSoValue. Trade execution is part of the product direction, but it lands in later phases behind confirm-to-execute UX, risk controls, and compliance review.

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
| **Vercel + Render + Fly.io** | Dashboard on Vercel, API/Edge on Render, Worker on Fly.io |
| **Sentry** | Errors and basic performance |

End-to-end **TypeScript**. Monorepo via pnpm workspaces + Turborepo. Drizzle ORM. grammY for Telegram. discord-interactions for Discord. WhatsApp Business Cloud API directly.

## Live Endpoints

### User entrypoints

- **MySoSo Panda Dashboard:** [https://my-soso-dashboard.vercel.app](https://my-soso-dashboard.vercel.app)
- **MySoSo Panda Telegram:** [https://t.me/mysoso_agent_bot](https://t.me/mysoso_agent_bot)
- **MySoSo Panda Discord:** [https://discord.com/oauth2/authorize?client_id=1502783425969651823](https://discord.com/oauth2/authorize?client_id=1502783425969651823)
- **MySoSo Panda WhatsApp:** Coming soon

### Backend services

- **API:** [https://my-soso-api.onrender.com](https://my-soso-api.onrender.com)
- **Edge:** [https://my-soso-edge.onrender.com](https://my-soso-edge.onrender.com)
- **Worker:** [https://my-soso-worker.fly.dev](https://my-soso-worker.fly.dev)

### Infrastructure

- **Redis:** Upstash Redis

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

Before starting Redis, make sure your local container runtime is running. `pnpm redis:up` uses your local container runtime and supports both Docker Desktop and Podman setups.

- **Docker Desktop:** Open Docker Desktop and wait for it to finish starting.
- **Podman:** Start your VM first with `podman machine start` (run `podman machine init` once if needed). If Podman is installed, the repo will prefer `podman compose`.

**Start Redis:**
```bash
pnpm redis:up
```

If you see an error like `unable to connect to Podman socket` or `connection refused`, your container runtime is not running yet.

Once Redis is already running, you do **not** need to run `pnpm redis:up` again unless you have stopped the container, restarted your machine, or brought the stack down manually.

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

### Wave 1 — Multi-channel signal and discussion agent
Telegram + Discord + WhatsApp on day one. Watchlists, AI-filtered news alerts, daily digests, research memos, and discussion-ready market signals powered entirely by SoSoValue. No execution yet.

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
- **Compliance-aware.** Every response is classified; execution is gated behind explicit confirmation, risk controls, and counsel review.
- **Observable from day one.** Structured logs, Sentry, one dashboard the team checks every morning.

---

## Status

**Wave 1 / Phases 1–4 complete; Phase 5 in progress.** Telegram is live through the dashboard + Edge → Redis → Worker path, Discord wiring is in place with install/link flow still being finalized, and WhatsApp is listed as coming soon. The deployed surfaces are: dashboard on Vercel, API + Edge on Render, worker on Fly.io, and Redis on Upstash.

Read [`architecture.md`](architecture.md) before writing code. Update it before changing something it describes.
