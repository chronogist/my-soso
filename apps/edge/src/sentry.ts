import * as Sentry from '@sentry/node';
import type { Config } from './config.js';

/**
 * Initialise Sentry early — must run before any imports that we want
 * traced. The before-send hook scrubs known secret-shaped strings as a
 * final safety net beyond pino redaction.
 */
export function initSentry(config: Config): void {
  if (!config.SENTRY_DSN) return;

  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT,
    tracesSampleRate: config.NODE_ENV === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      if (event.request?.headers) {
        for (const k of Object.keys(event.request.headers)) {
          const lower = k.toLowerCase();
          if (
            lower === 'authorization' ||
            lower === 'cookie' ||
            lower.startsWith('x-soso') ||
            lower.startsWith('x-telegram') ||
            lower.startsWith('x-signature') ||
            lower.startsWith('x-hub-signature')
          ) {
            event.request.headers[k] = '[Redacted]';
          }
        }
      }
      return event;
    },
  });
}

export { Sentry };
