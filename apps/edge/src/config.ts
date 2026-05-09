import { z } from 'zod';

// Treat empty-string env vars as missing — devs commonly leave optional
// keys defined-but-blank in .env, and zod's .url()/.min(1) would otherwise
// reject the whole config at boot.
const optionalString = () =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional());
const optionalUrl = () =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional());

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3002),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SENTRY_DSN: optionalUrl(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_BOT_TOKEN: optionalString(),
  TELEGRAM_WEBHOOK_URL: optionalUrl(),
  DISCORD_PUBLIC_KEY: optionalString(),
  WHATSAPP_VERIFY_TOKEN: optionalString(),
  WHATSAPP_APP_SECRET: optionalString(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid edge service configuration:\n${issues}`);
  }
  return parsed.data;
}
