import * as Sentry from '@sentry/node';
import type { Config } from './config.js';

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
          if (lower === 'authorization' || lower === 'cookie') {
            event.request.headers[k] = '[Redacted]';
          }
        }
      }
      return event;
    },
  });
}

export { Sentry };
