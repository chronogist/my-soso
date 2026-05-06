# Architecture Decision Records

Short records of the choices we'll be most tempted to second-guess later. Each one captures *why* we picked something so future-us doesn't undo it without re-reading the reasoning.

| # | Title | Status |
|---|---|---|
| [0001](0001-bullmq-over-kafka.md) | BullMQ on Redis over Kafka/Temporal | Accepted |
| [0002](0002-discord-http-interactions-over-gateway.md) | Discord HTTP Interactions over Gateway | Accepted |
| [0003](0003-global-sosovalue-cache-with-prefetcher.md) | Global SoSoValue cache with prefetcher | Accepted |
| [0004](0004-turnkey-or-privy-for-wave-3-signing.md) | Use Turnkey or Privy for Wave 3 signing | Proposed |
| [0005](0005-hash-partitioned-queues-over-bullmq-groups.md) | Hash-partitioned queues over BullMQ Groups | Accepted |
| [0006](0006-provider-abstraction-with-sosovalue-primary.md) | Provider abstraction with SoSoValue as primary | Accepted |

## How to write a new one

Copy an existing one. Keep it short — context, decision, consequences. If it's longer than two screens, you're trying to write a design doc, not an ADR.
