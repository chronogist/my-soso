import { z } from 'zod';

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    DASHBOARD_URL: z.string().url().default('http://localhost:3000'),
    SENTRY_DSN: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
    SENTRY_ENVIRONMENT: z.string().default('development'),
    PRIVY_APP_ID: z.string().min(1),
    PRIVY_JWT_VERIFICATION_KEY: z.string().min(1).optional(),
    PRIVY_JWKS_URL: z.string().url().optional(),
    LINK_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
    SOSOVALUE_API_KEY: z.string().min(1).optional(),
    SOSOVALUE_BASE_URL: z.string().url().optional(),
  })
  .refine((c) => c.PRIVY_JWKS_URL ?? c.PRIVY_JWT_VERIFICATION_KEY, {
    message: 'Set PRIVY_JWKS_URL (preferred) or PRIVY_JWT_VERIFICATION_KEY',
    path: ['PRIVY_JWKS_URL'],
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid API service configuration:\n${issues}`);
  }
  return parsed.data;
}
