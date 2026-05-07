import { createConnection } from '@my-soso/queue';
import { loadConfig } from './config.js';
import { startInboundConsumer } from './consumers/inbound.js';
import { startOutboundConsumer } from './consumers/outbound.js';
import { startAlertEngine } from './consumers/alert-engine.js';
import { startPrefetcher } from './consumers/prefetcher.js';
import { buildAgentStack } from './agent/factory.js';
import { startMetricsReporter } from './agent/metrics.js';
import { buildLogger } from './logger.js';
import { initSentry } from './sentry.js';

interface Shutdownable {
  close: () => Promise<void>;
}

function main() {
  const config = loadConfig();
  initSentry(config);

  const log = buildLogger(config);
  log.info('worker starting');

  const connection = createConnection({ url: config.REDIS_URL });

  const stack = buildAgentStack({ config, redis: connection, log });

  const inbound = startInboundConsumer({ connection, log, agent: stack.agent });
  const outbound = startOutboundConsumer({
    connection,
    log,
    telegramBotToken: config.TELEGRAM_BOT_TOKEN,
  });

  const consumers: Shutdownable[] = [inbound, outbound, stack];

  const metrics = startMetricsReporter({
    log,
    cacheCounters: stack.cacheCounters,
    budget: stack.budget,
  });
  consumers.push(metrics);

  if (config.PREFETCH_ENABLED && config.PREFETCH_SYMBOLS.length > 0) {
    const prefetcher = startPrefetcher({
      connection,
      log,
      provider: stack.provider,
      newsExtractor: stack.newsExtractor,
      symbols: config.PREFETCH_SYMBOLS,
      intervalMs: config.PREFETCH_INTERVAL_MS,
    });
    consumers.push(prefetcher);
  }

  if (config.ALERT_ENGINE_ENABLED) {
    const alerts = startAlertEngine({
      connection,
      log,
      db: stack.db,
      market: stack.provider,
      intervalMs: config.ALERT_ENGINE_INTERVAL_MS,
      cooldownMs: config.ALERT_COOLDOWN_MS,
      newsLookbackMs: config.ALERT_NEWS_LOOKBACK_MS,
    });
    consumers.push(alerts);
  }

  log.info('worker ready');

  const shutdown = async (signal: NodeJS.Signals) => {
    log.info({ signal }, 'shutting down');
    await Promise.allSettled(consumers.map((c) => c.close()));
    await connection.quit();
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void shutdown(signal));
  }

  process.stdin.resume();
}

main();
