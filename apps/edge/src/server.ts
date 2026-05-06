import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';

export function buildServer(config: Config): FastifyInstance {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  app.get('/healthz', () => ({ ok: true, service: 'edge', env: config.NODE_ENV }));

  return app;
}
