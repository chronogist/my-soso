import { createConnection } from '@my-soso/queue';
import { loadConfig } from './config.js';
import { startInboundConsumer } from './consumers/inbound.js';
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

  const inbound = startInboundConsumer({ connection, log });

  const consumers: Shutdownable[] = [inbound];

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
