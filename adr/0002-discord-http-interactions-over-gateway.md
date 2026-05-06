# ADR 0002 — Discord HTTP Interactions over Gateway

**Status:** Accepted
**Date:** 2026-05-06

## Context

Discord bots can receive events two ways:

1. **Gateway** — persistent WebSocket, receives all events including DMs and message creates.
2. **HTTP Interactions** — Discord POSTs slash-command and button events to our endpoint, we verify a signed request and respond.

Most tutorials and libraries (discord.js) default to Gateway. But Discord's docs are explicit: *"Gateway events that do not contain a `guild_id` will only be sent to the first shard (`shard_id: 0`). This includes Direct Message (DM)..."*

My-Soso is a **DM-first personal finance bot**. Sharding — Discord's standard horizontal scaling story — does not help us, because DMs all funnel through shard 0 regardless of how many shards we run.

## Decision

Use **HTTP Interactions** (the signed-request endpoint) for all Discord command flow in Wave 1. Implement with the lightweight `discord-interactions` library, not `discord.js`. Verify `X-Signature-Ed25519` on every request — Discord rejects bots that don't.

## Consequences

**Good**
- Stateless. Edge service receives Interactions exactly the same way it receives Telegram webhooks. Same horizontal-scaling story, same replicas, same load balancer.
- No persistent connection to manage, no shard-0 bottleneck, no reconnection logic.
- Smaller dependency footprint than discord.js (which pulls in voice, sharding, presence, etc. we don't need).

**Bad / accepted**
- Slash-command-only UX in Wave 1. Users start interactions with `/ask`, `/watch`, `/alert`, etc. — they can't just type free text.
- Discord enforces a 3-second deadline on the initial Interactions response. We use *deferred responses* (`type: 5`) to acknowledge instantly and follow up with the real reply via webhook. Worker handles this correctly.

**Trigger to revisit**
- We want users to type free-text in Discord DMs without a slash-command prefix (need `MESSAGE_CONTENT` intent + Gateway).
- Add a single Gateway sidecar at that point — it does *not* replace the HTTP path, just supplements it.
