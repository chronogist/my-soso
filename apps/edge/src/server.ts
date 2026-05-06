import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { buildLoggerOptions } from './logger.js';

export function buildServer(config: Config): FastifyInstance {
  const app = Fastify({
    logger: buildLoggerOptions(config),
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  app.get('/healthz', () => ({ ok: true, service: 'edge', env: config.NODE_ENV }));

  return app;
}
