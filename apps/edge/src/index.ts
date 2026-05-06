import { loadConfig } from './config.js';
import { initSentry } from './sentry.js';
import { buildServer } from './server.js';

async function main() {
  const config = loadConfig();
  initSentry(config);

  const app = buildServer(config);

  try {
    await app.listen({ host: '0.0.0.0', port: config.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutting down');
      void app.close().then(() => process.exit(0));
    });
  }
}

void main();
