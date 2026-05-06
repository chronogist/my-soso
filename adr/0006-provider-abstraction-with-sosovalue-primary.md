# ADR 0006 — Provider abstraction with SoSoValue as primary

**Status:** Accepted
**Date:** 2026-05-06

## Context

SoSoValue is the heart of our product and the showcase integration for the SoSoValue Buildathon. It's also a young API surface: the public docs flag real-time price endpoints as "coming soon," and the demo plan caps us at ~10 requests/min and ~10k/month. Two operational risks:

1. **Quota ceiling.** A burst of users could exhaust the monthly budget before launch day.
2. **Endpoint coverage.** If a feature we want depends on an endpoint not yet GA, we need a fallback path.

Architectural question: do we hard-code SoSoValue everywhere, or design a thin interface so we can supplement when needed?

## Decision

Code against `MarketDataProvider` and `NewsProvider` interfaces. **Wave 1 ships exactly one implementation: SoSoValue.** Its name appears in the dashboard, docs, and submission write-up — it's the integration we're showcasing. We do **not** build or ship a fallback in Wave 1.

We do, however, design the data layer so that adding a fallback implementation later (e.g. CoinGecko price-only safety net) is a config change, not a refactor. Interfaces are typed; the cache key namespace is provider-agnostic; alert rules don't bake in provider-specific assumptions.

## Consequences

**Good**
- Zero added complexity in Wave 1: one provider, one client, one set of tools.
- SoSoValue stays the headline integration — judges see SoSoValue everywhere.
- If we ever hit the monthly cap mid-event, we can add a price-only fallback without rewriting the cache, the agent tools, or the alert engine.
- Easy to demonstrate the design intent in the submission write-up: "We treat SoSoValue as the strategic data layer; the interface is there to make multi-source extension trivial when SoSoValue's roadmap and ours intersect."

**Bad / accepted**
- One thin layer of indirection between the Agent and the API. Worth it for the option value; near-zero runtime cost.
- A future engineer might add a fallback provider that subtly changes semantics (e.g. CoinGecko price ≠ SoSoValue price source-of-truth). Mitigation: provider responses include `source` metadata, and tests assert behavior against the SoSoValue baseline.

**Trigger to add a second implementation**
- We hit 95% monthly budget utilization and SoSoValue can't grant a quota uplift.
- A Wave 2/3 feature depends on a SoSoValue endpoint that isn't yet GA.
- Latency from a single provider becomes a bottleneck (unlikely with our caching).

**Not triggered by**
- "Just to have backup." Don't ship code we don't need.
