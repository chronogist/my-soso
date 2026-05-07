import type { Logger } from 'pino';
import type { BudgetTracker } from '@my-soso/providers';

export interface CacheCounters {
  hits: number;
  misses: number;
  errors: number;
}

export interface MetricsReporterOptions {
  log: Logger;
  cacheCounters: CacheCounters;
  /** Optional budget tracker; included in each report when present. */
  budget?: BudgetTracker;
  /** Interval between report emits in ms. Default 60_000. */
  intervalMs?: number;
}

export interface MetricsReporterHandle {
  close: () => Promise<void>;
}

/**
 * Emits a single structured log line at every interval describing
 * cache effectiveness and (when a budget tracker is wired) upstream
 * usage. The counters are *delta* — read-and-reset each tick — so a
 * log aggregator can sum across replicas without double-counting.
 *
 * Hit rate is the headline metric: per architecture.md the design
 * works only when the prefetcher keeps hit rate high enough that
 * on-demand calls fit inside the SoSoValue quota.
 */
export function startMetricsReporter(opts: MetricsReporterOptions): MetricsReporterHandle {
  const intervalMs = opts.intervalMs ?? 60_000;

  const tick = async () => {
    const hits = opts.cacheCounters.hits;
    const misses = opts.cacheCounters.misses;
    const errors = opts.cacheCounters.errors;
    opts.cacheCounters.hits = 0;
    opts.cacheCounters.misses = 0;
    opts.cacheCounters.errors = 0;

    const total = hits + misses;
    const hitRate = total > 0 ? hits / total : null;

    let budgetSnapshot: Awaited<ReturnType<BudgetTracker['snapshot']>> | undefined;
    if (opts.budget) {
      try {
        budgetSnapshot = await opts.budget.snapshot();
      } catch (err) {
        opts.log.warn({ err }, 'budget snapshot failed');
      }
    }

    opts.log.info(
      {
        cache: {
          hits,
          misses,
          errors,
          total,
          hitRate,
        },
        budget: budgetSnapshot
          ? {
              provider: budgetSnapshot.provider,
              callsUsed: budgetSnapshot.callsUsed,
              callsLimit: budgetSnapshot.callsLimit,
              utilizationPct: Math.round(
                (budgetSnapshot.callsUsed / budgetSnapshot.callsLimit) * 100,
              ),
              warnTripped: budgetSnapshot.warnTripped,
              hardStopTripped: budgetSnapshot.hardStopTripped,
            }
          : null,
      },
      'provider metrics tick',
    );
  };

  const handle = setInterval(() => void tick(), intervalMs);
  handle.unref?.();

  return {
    close: async () => {
      clearInterval(handle);
      // Emit one final tick so deltas are not lost on graceful shutdown.
      await tick();
    },
  };
}
