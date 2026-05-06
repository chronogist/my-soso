# ADR 0001 — BullMQ on Redis over Kafka/Temporal

**Status:** Accepted
**Date:** 2026-05-06

## Context

Edge service receives messages from Telegram/Discord and must hand work off to Worker service for LLM + SoSoValue calls. We need a queue between them for backpressure, retries, and idempotency. Realistic options:

- **BullMQ** (Redis-backed job queue, Node-native)
- **Kafka** (durable log, partitioned, designed for high-throughput streaming)
- **Temporal** (durable workflow engine)
- **NATS JetStream** (lightweight log)

Expected throughput in Wave 1: hundreds of messages/min peak, low thousands at most. Worker tasks are short (1–5s). Order matters per-conversation, not globally.

## Decision

Use **BullMQ on Redis** (Upstash). Inbound message ID becomes the BullMQ job ID for idempotency. Per-conversation ordering is enforced via deterministic hash partitioning across N inbound queues (see [ADR 0005](0005-hash-partitioned-queues-over-bullmq-groups.md)) — not BullMQ Groups, which is a paid Pro feature we're not using.

Queue Redis (`noeviction`, durable) is a separate instance from Cache Redis (eviction enabled). Mixing them is unsafe per BullMQ's docs.

## Consequences

**Good**
- Redis is already in the stack for caching and rate limiting — no new infra to operate.
- BullMQ ships with retries, delayed jobs, repeat jobs (handy for the alert cron), and a usable UI (Bull Board).
- TypeScript-native; no schema-registry / Avro / Java toolchain.
- Free tier (Upstash) is enough for Wave 1.

**Bad / accepted**
- Redis is not as durable as Kafka. We accept losing a job on a Redis node loss as long as we surface it in observability. Inbound message replay from Telegram/Discord is the recovery path if it ever matters.
- Throughput ceiling is roughly tens of thousands of jobs/min. Far above where we'll be for the foreseeable future.

**Trigger to revisit**
- Sustained queue depth > 10k or job throughput > 5k/min.
- Need for replay/audit semantics that BullMQ doesn't give us.
- Workflows that span minutes-to-hours with complex retry/compensation (would be Temporal's job).
