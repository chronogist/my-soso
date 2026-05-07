import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { buildLoggerOptions } from './logger.js';
import { Sentry } from './sentry.js';
import { registerDiscordWebhook } from './routes/discord.js';
import { registerTelegramWebhook } from './routes/telegram.js';

export function buildServer(config: Config): FastifyInstance {
  const app = Fastify({
    logger: buildLoggerOptions(config),
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    req.log.error({ err }, 'request failed');
    if (config.SENTRY_DSN) Sentry.captureException(err);
    void reply.status(err.statusCode ?? 500).send({
      error: err.name,
      message: err.message,
    });
  });

  app.get('/healthz', () => ({ ok: true, service: 'edge', env: config.NODE_ENV }));

  registerTelegramWebhook(app, config);
  registerDiscordWebhook(app, config);

  return app;
}
