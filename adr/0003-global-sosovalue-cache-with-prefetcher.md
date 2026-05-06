# ADR 0003 — Global SoSoValue cache with prefetcher

**Status:** Accepted
**Date:** 2026-05-06

## Context

SoSoValue's demo plan allows **10 requests/min and 10,000/month**, shared across all our users (we have one API key). Naive per-request fetching breaks at the third active user. This is the binding constraint for the entire system.

Options:

1. **Per-user fetch with cache** — fetch on demand, cache TTL per user. Doesn't help: a single user asking "BTC price" 11 times in a minute still trips the limit.
2. **Global cache with on-demand fetch** — fetch on miss, share across users. Better, but cold cache moments still spike.
3. **Global cache + background prefetcher** — proactively keep popular data fresh; on-demand fetches become rare.

## Decision

**Option 3.** A prefetcher cron loop in the Worker service pulls a curated set of popular data (top currencies, hot news, indices, ETF flow) every 2–5 minutes and writes Redis. The SoSoValue client always reads cache first; cache misses go through a token bucket capped at **6/min** (under the 10/min ceiling).

Steady-state outbound: ~3 calls/min. Headroom for misses: ~7/min. Monthly burn: well under 10k.

## Consequences

**Good**
- ~95% of user-driven queries never call the live API.
- Outbound volume is predictable (driven by the prefetcher schedule, not user behavior). Easier to capacity-plan.
- Adding more users does not increase SoSoValue API load *at all* until we expand the prefetcher set.
- The token bucket on the cache-miss path is a hard guarantee we can't accidentally exceed the limit.

**Bad / accepted**
- Some staleness. A 2-minute TTL on currency snapshots means a user could see a 2-minute-old BTC price. Acceptable for the use case (alerts handle the time-sensitive path).
- Long-tail asset queries (anything outside the prefetched set) will sometimes miss. Token bucket protects us; users see a brief delay or, at worst, "let me check on that" UX.
- One metric becomes load-bearing: **SoSoValue cache hit rate must stay >95%.** It's now the most important number on our dashboard.

**Trigger to revisit**
- SoSoValue announces a higher tier or per-user API keys → relax TTLs or move to per-user fetch.
- Cache hit rate drops below 90% → expand prefetcher set or widen TTLs before user impact.
- We add a feature where freshness matters more than 2 min (live trading prompts, etc.) — design a separate fast-path with its own budget.
