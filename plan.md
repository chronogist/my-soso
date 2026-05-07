# My-Soso

My-Soso is a personal finance agent that lives in your chat app. Sign up once, pick Telegram, Discord, or WhatsApp, and you get your own AI agent that watches the markets, tracks what you care about, and tells you what matters — without you ever opening another tab.

## Target user

Crypto holders and active traders who already live in Telegram, Discord, or WhatsApp and don't want to babysit price charts, scroll through news, or jump between dashboards to know what's happening with their money.

## Why it's useful

- **It comes to you.** No new app to open — alerts and answers land in the chat you already check 50 times a day.
- **It actually understands you.** Ask in plain English: *"why is ETH down today?"* or *"alert me on big Solana news."* No clunky commands.
- **It filters the noise.** Instead of 200 news headlines, you get the 2 that actually affect your portfolio.
- **It's always on.** Your personal analyst that doesn't sleep, doesn't charge $500/hr, and only pings you when something matters.
- **One agent, your way.** You set the watchlist, the alert rules, the tone. Everyone's My-Soso is different.

---

## Where we are

Wave 1 is split into 5 phases. Phase 1 (the spine) is complete. Phase 2 is next.

| Phase | What | State |
|---|---|---|
| 1 | Foundation: monorepo, DB+RLS, queue, Edge, Worker, Telegram round-trip | ✅ done |
| 2 | Privy auth + channel linking + real user resolution | ⏭ next |
| 3 | SoSoValue provider + cache + prefetcher + LLM agent (real Q&A) | — |
| 4 | Watchlists + alert engine + news filter + digest | — |
| 5 | Discord + WhatsApp adapters + compliance classifier + demo polish | — |

---

## Wave 1 — Telegram + Discord + WhatsApp MVP (advisory)

### Foundation (Phase 1) — done
- [x] Monorepo: pnpm workspaces + Turborepo + strict TS + ESLint + Prettier + Husky
- [x] Postgres schema + Drizzle migrations
- [x] RLS policies (FORCE on `users` + `channel_links`, USING + WITH CHECK, NULL-safe)
- [x] BullMQ queue plumbing on Redis (hash-partitioned inbound, outbound, DLQ-ready)
- [x] Per-conversation FIFO via sequence guard + Redis lock + concurrency:1
- [x] Edge service (Fastify): Telegram webhook, signature verification, private-chat filter
- [x] Worker service: inbound/outbound BullMQ consumers, command handler, graceful shutdown
- [x] Telegram adapter: verify, parse, send (Bot API)
- [x] `ChannelAdapter` foundations in `@my-soso/channels` (Telegram impl, Discord+WhatsApp slots reserved)
- [x] Sentry + pino structured logs with redaction across both services
- [x] `withSentry` wrap on every BullMQ processor
- [x] `.env.example` covering all Wave 1 keys

### Auth + linking (Phase 2)
- [ ] Web dashboard scaffold (Next.js 15 + App Router) on Railway
- [ ] Privy login (email + auto-provisioned embedded wallet)
- [ ] API service (Fastify) verifying Privy JWT against JWKS
- [ ] User upsert keyed on `privy_user_id` (with `SET LOCAL app.user_id` so RLS passes)
- [ ] Dashboard channel-link flow (generate code → user DMs `/link <code>` → write `channel_links`)
- [ ] Edge resolves real `userId` from `channel_links` (replace anonymous placeholder)
- [ ] Watchlist UI on dashboard (CRUD)

### SoSoValue agent (Phase 3)
- [ ] `MarketDataProvider` + `NewsProvider` interfaces in `@my-soso/providers`
- [ ] SoSoValue implementation (cached) with `x-soso-api-key` auth
- [ ] Prefetcher singleton (BullMQ repeatable job) — top currencies/news/indices/ETF
- [ ] Monthly budget tracker (`provider_usage_budgets` table)
- [ ] Per-minute SoSoValue token bucket (6/min)
- [ ] Anthropic Claude wired into Worker via Vercel AI SDK
- [ ] First two tools: `getPrice`, `getNewsForAsset`
- [ ] Replace echo fallback in inbound consumer with real agent
- [ ] Cache hit rate metric

### Tools, watchlists, alerts (Phase 4)
- [ ] Remaining tools: `getETFFlow`, `getIndex`, `listIndices`, watchlist CRUD, alert CRUD, `generateMemo`
- [ ] Daily/weekly digest scheduled BullMQ repeatable job
- [ ] Alert engine: rule eval against cache + news-relevance with one-LLM-extraction-per-article
- [ ] `notification_deliveries` dedup constraint
- [ ] Audit log on every advice-class response

### Multi-channel + compliance + demo (Phase 5)
- [ ] Discord HTTP Interactions adapter with deferred response (`type: 5`)
- [ ] Discord slash commands: `/ask`, `/watch`, `/alert`, `/memo`, `/link`
- [ ] WhatsApp Cloud API adapter with template selection (24h-window logic)
- [ ] Pre-approve WhatsApp templates: digest, alert, link-confirmation
- [ ] Compliance classifier + system prompt forbidding `recommendation`-class
- [ ] Demo video + submission writeup

---

## Wave 2 — AI signal layer + SoDEX read + SSI discovery

- [ ] SoDEX read API client (orderbook, prices, positions, depth)
- [ ] SSI Protocol API client (index discovery)
- [ ] Opportunity discovery engine
- [ ] News-to-signal extraction
- [ ] Weekly portfolio digest
- [ ] Sentiment shift alerts
- [ ] Telegram inline buttons UX
- [ ] Discord embeds UX
- [ ] WhatsApp interactive messages (buttons / lists)
- [ ] Conversation memory across turns
- [ ] Prompt-injection regression tests in CI

## Wave 3 — SoDEX execution + risk controls + polish

- [ ] Privy session-key flow (scoped, time-bounded signing authority)
- [ ] SoDEX execute API integration via Privy-signed EIP-712
- [ ] Approve/Reject confirmation flow in chat
- [ ] Per-user spending + daily caps (enforced in Privy + SoDEX)
- [ ] Trade-size caps
- [ ] Optional 2FA on execution
- [ ] SSI follow-index / auto-rebalance (stretch)
- [ ] Counsel review of user agreement, classifier, and confirm-to-execute UX
- [ ] Onboarding polish + error handling
- [ ] Public landing page
- [ ] Pitch deck

---

## How to resume

1. `pnpm install`
2. Copy `.env.example` → `.env` and fill in: `DATABASE_URL`, `REDIS_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, plus Sentry optional.
3. `pnpm db:migrate` to apply `0000_initial.sql` and `0001_rls_hardening.sql` to Neon.
4. `pnpm dev:edge` and `pnpm dev:worker` in two terminals.
5. Expose Edge via ngrok and register the Telegram webhook with your `TELEGRAM_WEBHOOK_SECRET`.
6. `/start` in Telegram → "Welcome to My-Soso..." — round-trip working.
7. Phase 2 begins: scaffold `apps/dashboard` (Next.js) and `apps/api` (Fastify) and wire Privy login.
