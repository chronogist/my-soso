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

## Wave 1 — Telegram + Discord + WhatsApp MVP (advisory)

- [ ] Web dashboard: Privy signup + channel selection + watchlist setup
- [ ] Postgres schema + Drizzle migrations + RLS policies
- [ ] Channel-agnostic agent core (LLM + tool-calling)
- [ ] `ChannelAdapter` interface
- [ ] Telegram adapter (webhook)
- [ ] Discord adapter (HTTP Interactions, deferred response)
- [ ] WhatsApp adapter (Cloud API webhook + approved templates)
- [ ] SoSoValue `MarketDataProvider` + `NewsProvider` (cached)
- [ ] Prefetcher singleton + monthly budget tracker
- [ ] On-demand Q&A (price, news, fundamentals, flows, indices)
- [ ] Watchlist tracking + daily/weekly digest
- [ ] LLM-filtered news alerts (one extraction per article, not per user)
- [ ] Price + flow threshold alerts with `notification_deliveries` dedup
- [ ] Research memo generator
- [ ] Compliance classifier + audit log
- [ ] Sentry + structured logs
- [ ] Demo video + docs

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
