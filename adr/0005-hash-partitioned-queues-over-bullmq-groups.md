# ADR 0005 — Hash-partitioned queues over BullMQ Groups

**Status:** Accepted
**Date:** 2026-05-06

## Context

Per-conversation ordering matters: if a user sends "watch BTC" then "list my watchlist", the first must commit before the second reads. Concurrent processing across N worker pods can reorder them.

The clean answer in BullMQ is **Groups** — group jobs by key, processed serially per key, parallel across keys. Problem: **BullMQ Groups is a paid Pro feature**, not open source.

## Decision

Use **deterministic hash partitioning** across a fixed number of inbound queues. Wave 1: `N = 8` queues (`inbound:0` … `inbound:7`). Each inbound job is routed to `inbound:{conversation_hash % N}`. Each partition has its own worker(s). Jobs within a partition are processed in FIFO order, so same-conversation jobs (which always hash to the same partition) are serial.

State mutations (writes to `messages`, `watchlist_items`, `alert_rules`) carry the inbound `idempotencyKey` so retries don't double-apply.

## Consequences

**Good**
- No paid dependency on BullMQ Pro.
- Trivially scalable: add more partitions (re-route by `% (N+M)`) when load demands it. Cross-partition reordering can't happen because conversations don't migrate.
- Workers can scale independently per partition if some hot conversations dominate.

**Bad / accepted**
- A noisy partition (one user blasting messages) slows that partition only — not the system. Acceptable; it's actually the correct isolation behavior.
- Re-partitioning (changing N) requires draining old partitions first to avoid out-of-order processing during the transition. Documented in the runbook.
- Slight loss of perfect global FIFO. We don't need it — only per-conversation FIFO.

**Trigger to revisit**
- Severe partition skew (one partition is consistently 10× the load of others) → consistent hashing instead of modulo.
- We need transactional cross-conversation ordering (we don't, today).
- Free BullMQ Groups equivalent appears (some forks offer it).
