import * as Sentry from '@sentry/node';
import type { Config } from './config.js';

export function initSentry(config: Config): void {
  if (!config.SENTRY_DSN) return;

  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT,
    tracesSampleRate: config.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}

export { Sentry };

/**
 * Wraps an async unit of work so any thrown error is reported to Sentry
 * before being re-thrown. Use around BullMQ job handlers and scheduled jobs.
 */
export async function withSentry<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    Sentry.captureException(err, { tags: { unit_of_work: name } });
    throw err;
  }
}
