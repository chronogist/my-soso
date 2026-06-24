import {
  composeProvider,
  createPgBudgetTracker,
  createRedisProviderCache,
  SoSoValueProvider,
  type BudgetTracker,
  type MarketDataProvider,
  type NewsProvider,
} from '@my-soso/providers';
import { createTokenBucket, type Redis } from '@my-soso/queue';
import { createDb, type Database } from '@my-soso/db';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import { createAgent, type Agent } from './agent.js';
import { createComplianceClassifier, type ComplianceClassifier } from './compliance.js';
import { createNewsExtractor, type NewsExtractor } from './news-extractor.js';

export interface AgentStack {
  agent: Agent;
  compliance: ComplianceClassifier;
  /** Composed provider, exported so the prefetcher can warm it. */
  provider: MarketDataProvider & NewsProvider;
  /** Cache hit-rate counters; periodically logged for observability. */
  cacheCounters: { hits: number; misses: number; errors: number };
  /** Monthly budget tracker; reused by the metrics reporter. */
  budget: BudgetTracker;
  /** News extractor; consumed by the prefetcher and (later) the alert engine. */
  newsExtractor: NewsExtractor;
  /** Database handle exposed so the alert engine can read alerts and write deliveries. */
  db: Database;
  close: () => Promise<void>;
}

/**
 * Wires SoSoValue → cache → token bucket → monthly budget → agent.
 * The worker's lifecycle owns the returned `close` so the db pool
 * we open here cleans up on SIGTERM.
 */
export function buildAgentStack({
  config,
  redis,
  log,
}: {
  config: Config;
  redis: Redis;
  log: Logger;
}): AgentStack {
  const counters = { hits: 0, misses: 0, errors: 0 };

  const cache = createRedisProviderCache(redis, {
    keyPrefix: 'provider-cache',
    metrics: {
      onHit: () => counters.hits++,
      onMiss: () => counters.misses++,
      onError: (key, err) => {
        counters.errors++;
        log.warn({ key, err }, 'provider cache error');
      },
    },
  });

  const rateLimit = createTokenBucket(redis, {
    name: 'sosovalue:rpm',
    refillRate: config.SOSOVALUE_RPM_BUDGET,
    refillIntervalMs: 60_000,
  });

  // Budget tracker uses its own small db pool. It's separate from the
  // API's pool because the worker process has no other db access in
  // Wave 1 — the user-resolution path lives in the edge.
  const db = createDb({ url: config.DATABASE_URL, max: 2 });
  const budget = createPgBudgetTracker({
    db,
    provider: 'sosovalue',
    monthlyLimit: config.SOSOVALUE_MONTHLY_BUDGET,
  });

  const inner = new SoSoValueProvider({
    apiKey: config.SOSOVALUE_API_KEY,
    ...(config.SOSOVALUE_BASE_URL ? { baseUrl: config.SOSOVALUE_BASE_URL } : {}),
  });

  // Request flow through the composed provider:
  //   cache.get(→ on hit → return)
  //     → on miss → rateLimit.take(→ denied → RateLimitedError)
  //       → allowed → budget.recordCall(→ exhausted → silent no-op)
  //         → inner.getPrice (SoSoValue API)
  //
  // Cache errors are fail-open (fall through to the next layer).
  // Rate-limit denies propagate upward as RateLimitedError to the agent.
  // Budget exhaustion is a silent no-op (the call is counted but not blocked).
  const provider = composeProvider({
    inner,
    cache,
    rateLimit,
    budget,
  });

  const agent = createAgent({
    market: provider,
    news: provider,
    db,
    log,
    openRouterApiKey: config.OPENROUTER_API_KEY,
    model: config.OPENROUTER_MODEL,
  });

  const compliance = createComplianceClassifier({
    openRouterApiKey: config.OPENROUTER_API_KEY,
    model: config.OPENROUTER_MODEL,
    log,
  });

  const newsExtractor = createNewsExtractor({
    db,
    log,
    openRouterApiKey: config.OPENROUTER_API_KEY,
    model: config.OPENROUTER_MODEL,
  });

  return {
    agent,
    compliance,
    provider,
    cacheCounters: counters,
    budget,
    newsExtractor,
    db,
    close: async () => {
      await db.$client.end({ timeout: 5 });
    },
  };
}
