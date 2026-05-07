import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  TELEGRAM_BOT_TOKEN: z.string().min(1),

  // Phase 3: SoSoValue + Anthropic agent.
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1).default('claude-haiku-4-5-20251001'),
  SOSOVALUE_API_KEY: z.string().min(1),
  SOSOVALUE_BASE_URL: z.string().url().optional(),
  /** Per-minute call cap for SoSoValue. Demo plan documents 10 rpm; we leave
   * headroom by defaulting to 6 rpm. */
  SOSOVALUE_RPM: z.coerce.number().int().positive().default(6),
  /** Monthly call budget for SoSoValue. Demo plan documents ~10k/month. */
  SOSOVALUE_MONTHLY_LIMIT: z.coerce.number().int().positive().default(10_000),

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
