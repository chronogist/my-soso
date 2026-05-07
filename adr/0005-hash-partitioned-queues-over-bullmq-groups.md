# ADR 0005 — Hash-partitioned queues over BullMQ Groups

**Status:** Accepted
**Date:** 2026-05-06

## Context

Per-conversation ordering matters: if a user sends "watch BTC" then "list my watchlist", the first must commit before the second reads. Concurrent processing across N worker pods can reorder them.

The clean answer in BullMQ is **Groups** — group jobs by key, processed serially per key, parallel across keys. Problem: **BullMQ Groups is a paid Pro feature**, not open source.

## Decision

Use **deterministic hash partitioning** across a fixed number of inbound queues. Wave 1: `N = 8` queues (`inbound:0` … `inbound:7`). Each inbound job is routed to `inbound:{conversation_hash % N}`.

Hash partitioning alone does **not** give strict per-conversation FIFO once retries and multiple replicas are in play (a retried out-of-order job can land first when a lock frees). So we layer two additional guards:

1. **Per-conversation sequence guard.** Edge stamps every inbound job with a strictly monotonic `seqNo` (Redis `INCR` per conversation). The Worker only processes when `seqNo == lastProcessed + 1`; otherwise it throws and BullMQ requeues with backoff. Ordering becomes independent of retry timing or replica count.

2. **Per-conversation Redis lock.** Mutual-exclusion guard for the rare case where two replicas race on the same `seqNo` (e.g. a job redelivered after worker death). Defense-in-depth, not load-bearing for ordering.

3. **Inbound consumer concurrency:1** per partition. Defense-in-depth so a single replica doesn't pull two same-conversation jobs at once.

State mutations carry the inbound `idempotencyKey` so retries don't double-apply.

## Consequences

**Good**
- No paid dependency on BullMQ Pro.
- Trivially scalable: add more partitions (re-route by `% (N+M)`) when load demands it. Cross-partition reordering can't happen because conversations don't migrate.
- Workers can scale independently per partition if some hot conversations dominate.

**Bad / accepted**
- A noisy partition (one user blasting messages) slows that partition only — not the system. Acceptable; it's actually the correct isolation behavior.
- Re-partitioning (changing N) requires draining old partitions first to avoid out-of-order processing during the transition. Documented in the runbook.
- Slight loss of perfect global FIFO. We don't need it — only per-conversation FIFO.
- A stuck inbound message (failed past max retries) blocks subsequent messages in that conversation until the operator clears the DLQ or manually advances the processed-seq counter. Surfaced via DLQ alerting.

**Trigger to revisit**
- Severe partition skew (one partition is consistently 10× the load of others) → consistent hashing instead of modulo.
- We need transactional cross-conversation ordering (we don't, today).
- Free BullMQ Groups equivalent appears (some forks offer it).
