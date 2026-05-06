import pino, { type Logger } from 'pino';
import type { Config } from './config.js';

const REDACT_PATHS: string[] = [
  '*.token',
  '*.apiKey',
  '*.secret',
  '*.password',
  'config.DATABASE_URL',
  'config.REDIS_URL',
  'config.SENTRY_DSN',
];

export function buildLogger(config: Config): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: 'worker', env: config.NODE_ENV },
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
