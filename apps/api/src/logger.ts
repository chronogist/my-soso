import pino, { type LoggerOptions } from 'pino';
import type { Config } from './config.js';

const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.token',
  '*.apiKey',
  '*.secret',
  '*.password',
  'config.DATABASE_URL',
  'config.REDIS_URL',
  'config.SENTRY_DSN',
  'config.PRIVY_JWT_VERIFICATION_KEY',
];

export function buildLoggerOptions(config: Config): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    base: { service: 'api', env: config.NODE_ENV },
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}
