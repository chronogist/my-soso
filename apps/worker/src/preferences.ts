import { eq } from 'drizzle-orm';
import { schema, type Database } from '@my-soso/db';
import { z } from 'zod';

/**
 * Bot-behavior preferences saved by the dashboard `/hub` UI into
 * `users.preferences` (JSONB). The shape mirrors the dashboard's
 * `BotPreferences` type. Worker pipelines load and consult this object
 * to honor user-chosen tone, quiet hours, throttling, coverage, etc.
 *
 * Stored values may be partial / legacy — always merge with defaults
 * before reading individual fields.
 */
const Tone = z.enum(['concise', 'casual', 'formal']);
const Verbosity = z.enum(['short', 'normal', 'long']);
const NewsStrength = z.enum(['major_only', 'portfolio', 'all']);
const DigestSection = z.enum(['prices', 'news', 'etf_flows', 'indices', 'macro']);
const Channel = z.enum(['telegram', 'discord', 'whatsapp']);

const BotPreferencesSchema = z.object({
  tone: Tone.default('concise'),
  verbosity: Verbosity.default('normal'),
  language: z.string().default('en'),
  timezone: z.string().default('UTC'),
  digestTime: z.string().default('08:00'),
  digestWeekday: z.number().int().min(0).max(6).default(1),
  digestSections: z.array(DigestSection).default(['prices', 'news']),
  quietHours: z
    .object({
      enabled: z.boolean().default(false),
      start: z.string().default('22:00'),
      end: z.string().default('07:00'),
    })
    .default({ enabled: false, start: '22:00', end: '07:00' }),
  throttling: z
    .object({
      maxPerHour: z.number().int().min(0).default(6),
      maxPerDay: z.number().int().min(0).default(40),
    })
    .default({ maxPerHour: 6, maxPerDay: 40 }),
  newsFilter: z
    .object({
      strength: NewsStrength.default('portfolio'),
      sources: z.array(z.enum(['hot', 'featured', 'search'])).default(['hot', 'featured']),
      explainImpact: z.boolean().default(true),
    })
    .default({ strength: 'portfolio', sources: ['hot', 'featured'], explainImpact: true }),
  coverage: z
    .object({
      currencies: z.boolean().default(true),
      etfs: z.boolean().default(true),
      ssiIndices: z.boolean().default(true),
      cryptoStocks: z.boolean().default(false),
      btcTreasuries: z.boolean().default(false),
      fundraising: z.boolean().default(false),
      macro: z.boolean().default(false),
    })
    .default({
      currencies: true,
      etfs: true,
      ssiIndices: true,
      cryptoStocks: false,
      btcTreasuries: false,
      fundraising: false,
      macro: false,
    }),
  formatting: z
    .object({
      includeCharts: z.boolean().default(false),
      includeLinks: z.boolean().default(true),
      includeCitations: z.boolean().default(true),
      memoCommandEnabled: z.boolean().default(false),
    })
    .default({
      includeCharts: false,
      includeLinks: true,
      includeCitations: true,
      memoCommandEnabled: false,
    }),
  channelOverrides: z
    .partialRecord(
      Channel,
      z
        .object({
          enabled: z.boolean().optional(),
          tone: Tone.optional(),
          muteAlerts: z.boolean().optional(),
        })
        .optional(),
    )
    .default({}),
});

export type BotPreferences = z.infer<typeof BotPreferencesSchema>;
export type Tone = z.infer<typeof Tone>;
export type Verbosity = z.infer<typeof Verbosity>;

export const DEFAULT_PREFERENCES: BotPreferences = BotPreferencesSchema.parse({});

/**
 * Parse a stored preferences blob and fill in any missing fields with
 * defaults. Tolerates legacy / partial saves: malformed values fall back
 * to defaults rather than throwing — chat replies must never block on a
 * preference parse error.
 */
export function parsePreferences(raw: unknown): BotPreferences {
  const result = BotPreferencesSchema.safeParse(raw ?? {});
  return result.success ? result.data : DEFAULT_PREFERENCES;
}

/**
 * Load a user's preferences from `users.preferences`. Falls back to
 * defaults if the row is missing — preferences are never load-bearing
 * for delivering a reply.
 */
export async function loadUserPreferences(db: Database, userId: string): Promise<BotPreferences> {
  const rows = await db
    .select({ preferences: schema.users.preferences })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return parsePreferences(rows[0]?.preferences);
}
