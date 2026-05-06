import pino, { type LoggerOptions } from 'pino';
import type { Config } from './config.js';

/**
 * Paths whose values must never appear in logs. Pino walks each path against
 * the log object and replaces matches with `[Redacted]`.
 *
 * Add new paths here whenever a new secret-shaped field can land in a log.
 */
const REDACT_PATHS: string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-soso-api-key"]',
  'req.headers["x-telegram-bot-api-secret-token"]',
  'req.headers["x-signature-ed25519"]',
  'req.headers["x-hub-signature-256"]',
  '*.token',
  '*.apiKey',
  '*.secret',
  '*.password',
  'config.DATABASE_URL',
  'config.REDIS_URL',
  'config.SENTRY_DSN',
];

export function buildLoggerOptions(config: Config): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    base: { service: 'edge', env: config.NODE_ENV },
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}
