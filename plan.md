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

Wave 1 is split into 5 phases. Phases 1–4 are complete, and Phase 5 is now partially complete.

| Phase | What | State |
|---|---|---|
| 1 | Foundation: monorepo, DB+RLS, queue, Edge, Worker, Telegram round-trip | ✅ done |
| 2 | Privy auth + channel linking + real user resolution | ✅ done |
| 3 | SoSoValue provider + cache + prefetcher + LLM agent (real Q&A) | ✅ done |
| 4 | Watchlists + alert engine + news filter + digest | ✅ done |
| 5 | Discord + WhatsApp adapters + compliance classifier + dashboard polish + demo polish | 🚧 in progress |

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
- [x] Web dashboard scaffold (Next.js 15 + App Router) on Railway
- [x] Privy login (email + auto-provisioned embedded wallet)
- [x] API service (Fastify) verifying Privy JWT against Privy verification key
- [x] User upsert keyed on `privy_user_id` (with explicit service context + tenant RLS)
- [x] Dashboard channel-link flow (generate code → user DMs `/link <code>` → write `channel_links`)
- [x] Edge resolves real `userId` from `channel_links` (replace anonymous placeholder)
- [x] Watchlist UI on dashboard (CRUD)
- [x] Channel picker landing page with Telegram / WhatsApp / Discord selection
- [x] Shared `/setup` hub with account summary, platform-specific link instructions, link-code timer, linked-channel list, and watchlist controls

### SoSoValue agent (Phase 3) — done
- [x] `MarketDataProvider` + `NewsProvider` interfaces in `@my-soso/providers`
- [x] SoSoValue implementation (cached) with `x-soso-api-key` auth
- [x] Prefetcher singleton (BullMQ repeatable job) — top currencies/news/indices/ETF
- [x] Monthly budget tracker (`provider_usage_budgets` table)
- [x] Per-minute SoSoValue token bucket (6/min)
- [x] Anthropic Claude wired into Worker via Vercel AI SDK
- [x] First two tools: `getPrice`, `getNewsForAsset`
- [x] Replace echo fallback in inbound consumer with real agent
- [x] Cache hit rate metric

### Tools, watchlists, alerts (Phase 4) — done
- [x] Remaining tools: `getETFFlow`, `getIndex`, `listIndices`, watchlist CRUD, alert CRUD
- [x] Daily/weekly digest scheduled BullMQ repeatable job
- [x] Alert engine: rule eval against cache + news-relevance with one-LLM-extraction-per-article
- [x] `notification_deliveries` dedup constraint
- [x] Audit log on every agent response (classifier in phase 5 upgrades the column)
- [ ] `generateMemo` tool — deferred; not on the critical path for the wave 1 demo

### Multi-channel + compliance + demo (Phase 5) — in progress
- [x] Discord HTTP Interactions adapter with deferred response (`type: 5`)
- [x] Discord slash commands: `/ask`, `/watch`, `/alert`, `/link`
- [ ] Discord `/memo`
- [x] WhatsApp Cloud API adapter with template selection (24h-window logic)
- [ ] Pre-approve WhatsApp templates: digest, alert, link-confirmation
- [x] Compliance classifier + outbound fallback forbidding `recommendation`/`execution`-class replies
- [ ] Extend dashboard setup UX with post-link guidance to actual live entrypoints (`@MySoSoBot`, Discord app install/interactions URL, WhatsApp number copy)
- [x] Add dashboard surfaces for alert management and digest preferences (tabbed `/hub` with bot-personality, news filter, quiet hours, throttling, coverage, per-channel overrides, locked Wave-3 trading section). Worker-side enforcement of `users.preferences` is the follow-up.
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

## What’s next to build

1. **Finish the setup-to-chat handoff**
   - Wire the dashboard copy/actions to real production entrypoints for each platform.
   - Telegram: bot username + webhook registration.
   - Discord: app install, Interactions endpoint, slash-command registration, `/memo`.
   - WhatsApp: real business number, webhook verification, approved templates.

2. **Add user-facing controls that are already supported in the backend**
   - Alert management UI on the dashboard.
   - Digest preference / schedule UI on the dashboard.

3. **Close the production-readiness gaps**
   - Approve WhatsApp templates: `digest`, `alert`, `link-confirmation`.
   - Resolve the worker-side `drizzle-orm` type/version mismatch so the repo is back to a clean compile.
   - Produce the demo flow and submission writeup.

## How to resume

1. `pnpm install`
2. Copy `.env.example` → `.env` and fill in: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `REDIS_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, plus Sentry optional.
3. `pnpm db:migrate` to apply the SQL migrations to Supabase.
4. `pnpm dev:dashboard`, `pnpm dev:api`, `pnpm dev:edge`, and `pnpm dev:worker` in separate terminals.
5. Open the dashboard, choose a platform, and use the `/setup` flow to generate a link code.
6. Expose Edge publicly and register the appropriate webhook / interactions endpoint for Telegram, Discord, and WhatsApp.
7. Register Discord slash commands with `pnpm discord:register`.
8. Finish the remaining Phase 5 items in the “What’s next to build” section above.
