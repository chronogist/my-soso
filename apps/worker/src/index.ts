import { createConnection } from '@my-soso/queue';
import { loadConfig } from './config.js';
import { startInboundConsumer } from './consumers/inbound.js';
import { startOutboundConsumer } from './consumers/outbound.js';
import { buildAgentStack } from './agent/factory.js';
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
