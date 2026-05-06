import { loadConfig } from './config.js';
import { buildLogger } from './logger.js';

interface Shutdownable {
  close: () => Promise<void>;
}

function main() {
  const config = loadConfig();
  const log = buildLogger(config);

  log.info('worker started');

  // Consumers will register themselves here in subsequent commits.
  const consumers: Shutdownable[] = [];

  const shutdown = async (signal: NodeJS.Signals) => {
    log.info({ signal }, 'shutting down');
    await Promise.allSettled(consumers.map((c) => c.close()));
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void shutdown(signal));
  }

  // Keep the event loop alive until a shutdown signal arrives.
  process.stdin.resume();
}

main();
