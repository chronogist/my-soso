import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { createConnection } from '@my-soso/queue';
import { healthCheck, createDb, closeDb } from '@my-soso/db';
import type { Config } from './config.js';
import { createPrivyVerifier } from './auth/privy.js';
import { buildLoggerOptions } from './logger.js';
import { registerV1Routes } from './routes/v1.js';
import { Sentry } from './sentry.js';

export async function buildServer(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildLoggerOptions(config),
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 512 * 1024,
  });

  await app.register(cors, {
    origin: config.DASHBOARD_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const statusCode = err.statusCode ?? 500;
    req.log.error({ err, statusCode }, 'request failed');
    if (config.SENTRY_DSN) Sentry.captureException(err);
    void reply.status(statusCode).send({
      error: err.name,
      message: statusCode >= 500 ? 'internal server error' : err.message,
    });
  });

  const db = createDb({ url: config.DATABASE_URL, max: 10 });
  app.get('/healthz', async () => ({
    service: 'api',
    env: config.NODE_ENV,
    db: await healthCheck(db),
  }));

  const redis = createConnection({ url: config.REDIS_URL });
  const verifier = await createPrivyVerifier({
    appId: config.PRIVY_APP_ID,
    verificationKey: config.PRIVY_JWT_VERIFICATION_KEY,
    jwksUrl: config.PRIVY_JWKS_URL,
  });

  app.addHook('onClose', async () => {
    await redis.quit();
    await closeDb(db);
  });

  registerV1Routes(app, { config, verifier, redis, db });

  return app;
}
