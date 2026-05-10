import { z } from 'zod';

// Treat empty-string env vars as missing — devs commonly leave optional
// keys defined-but-blank in .env, and zod's .url()/.min(1) would otherwise
// reject the whole config at boot.
function stripInlineComment(v: unknown) {
  if (typeof v !== 'string') return v;
  return v.trim().replace(/\s+#.*$/, '');
}
const optionalString = () =>
  z.preprocess((v) => {
    const cleaned = stripInlineComment(v);
    return cleaned === '' ? undefined : cleaned;
  }, z.string().min(1).optional());
const optionalUrl = () =>
  z.preprocess((v) => {
    const cleaned = stripInlineComment(v);
    return cleaned === '' ? undefined : cleaned;
  }, z.string().url().optional());

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SENTRY_DSN: optionalUrl(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  TELEGRAM_BOT_TOKEN: z.preprocess(stripInlineComment, z.string().min(1)),
  DISCORD_BOT_TOKEN: optionalString(),
  WHATSAPP_ACCESS_TOKEN: optionalString(),
  WHATSAPP_PHONE_NUMBER_ID: optionalString(),

  // Phase 3: SoSoValue + OpenRouter-backed agent.
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().min(1).default('openai/gpt-4o-mini'),
  SOSOVALUE_API_KEY: z.string().min(1),
  SOSOVALUE_BASE_URL: z.string().url().optional(),
  /** Per-minute call cap for SoSoValue. Demo plan documents 10 rpm; we leave
   * headroom by defaulting to 6 rpm. */
  SOSOVALUE_RPM_BUDGET: z.coerce.number().int().positive().default(6),
  /** Monthly call budget for SoSoValue. Demo plan documents ~10k/month. */
  SOSOVALUE_MONTHLY_BUDGET: z.coerce.number().int().positive().default(10_000),

  /** Comma-separated list of symbols the prefetcher keeps warm. */
  PREFETCH_SYMBOLS: z
    .string()
    .default('BTC,ETH,SOL')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0),
    ),
  /** Prefetch tick cadence in milliseconds. */
  PREFETCH_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  /** Disable the prefetcher entirely (e.g. on a worker that shouldn't run cluster-wide singletons). */
  PREFETCH_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** Alert engine: tick cadence, cooldown between fires of the same alert, news lookback. */
  ALERT_ENGINE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  ALERT_ENGINE_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  ALERT_COOLDOWN_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60_000),
  ALERT_NEWS_LOOKBACK_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(6 * 60 * 60_000),

  /** Digest job: hourly tick, fires daily at this UTC hour, weekly on this UTC dow. */
  DIGEST_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  DIGEST_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60_000),
  DIGEST_DAILY_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(9),
  DIGEST_WEEKLY_DOW_UTC: z.coerce.number().int().min(0).max(6).default(1),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid worker service configuration:\n${issues}`);
  }
  return parsed.data;
}
