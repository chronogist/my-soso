# Wave 1 Demo Flow

This is the recommended submission demo path for the Telegram, Discord, and WhatsApp advisory MVP.

## Pre-Demo Checklist

- Dashboard, API, Edge, Worker, Redis, and Postgres are deployed and healthy.
- `.env` / Railway variables include production values for Privy, Redis, Postgres, SoSoValue, Anthropic, Telegram, Discord, and WhatsApp.
- Telegram webhook points to `${EDGE_URL}/webhooks/telegram`.
- Discord interactions endpoint points to `${EDGE_URL}/webhooks/discord`.
- Discord slash commands are registered with `pnpm discord:register`.
- WhatsApp webhook verify token and app secret are configured.
- WhatsApp templates are approved in Meta:
  - `digest`
  - `alert`
  - `link_confirmation`

## Demo Script

1. Open the My-Soso dashboard.
2. Sign in with Privy email.
3. Choose Telegram from the channel picker.
4. Generate a Telegram link code.
5. Open `@MySoSoBot`, send `/link CODE`, and show the linked-channel confirmation.
6. Add `BTC`, `ETH`, and `SOL` to the dashboard watchlist.
7. Ask in Telegram: `Why is ETH moving today?`
8. Set an alert in chat: `Alert me if BTC rises above 120000`.
9. Return to the dashboard and show the alert management controls.
10. Change digest cadence to `Daily`.
11. Switch to Discord setup, generate a Discord link code, and run `/link CODE`.
12. Run `/ask` with a market question.
13. Run `/memo` and show the concise watchlist memo.
14. Switch to WhatsApp setup, generate a WhatsApp link code, and send `/link CODE`.
15. Show WhatsApp confirmation and explain template-backed alert/digest delivery.

## Submission Writeup

My-Soso is a personal crypto market analyst that lives where traders already are: Telegram, Discord, and WhatsApp. A user signs in once, links a chat account, chooses a watchlist, and gets market answers, alerts, and digests without opening another dashboard.

Wave 1 proves the core loop end to end:

- Privy-backed dashboard onboarding.
- Real channel linking for Telegram, Discord, and WhatsApp.
- SoSoValue-powered market data and news.
- Claude-powered natural-language Q&A with compliance filtering.
- Watchlist management.
- Price and news alerts.
- Daily or weekly digest preferences.
- Discord slash commands including `/ask`, `/watch`, `/alert`, `/link`, and `/memo`.
- WhatsApp template-backed delivery slots for digests, alerts, and link-confirmation messages.

The product is advisory only in Wave 1. It explains market context, summarizes relevant news, and helps users configure alerts, but it does not recommend trades or execute orders. That boundary is enforced by the agent prompt and the outbound compliance classifier.

## What To Say In The Video

"My-Soso is for people who live in chat and do not want to babysit charts. I sign in once, link the chat app I already use, add assets I care about, and then My-Soso watches the market for me. I can ask plain-English questions, set alerts, and get digests. The same account works across Telegram, Discord, and WhatsApp, and the system stays advisory: it explains what is happening without telling me what to buy or sell."

## Known Wave 1 Limits

- WhatsApp template approval happens in Meta and must be completed before production template sends work.
- Discord command registration must be rerun after changing command definitions.
- Trade execution, session keys, and SoDEX writes are Wave 3 work.
- Rich Discord embeds and WhatsApp interactive buttons are Wave 2 work.
