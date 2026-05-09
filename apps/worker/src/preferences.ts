import { eq, inArray } from 'drizzle-orm';
import { schema, type Database } from '@my-soso/db';
import type { Redis } from '@my-soso/queue';
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

/**
 * Batch-load preferences for many users in a single round trip. Used by
 * the alert engine and digest sender, which iterate over users and need
 * each user's preferences before deciding whether to send.
 */
export async function loadUserPreferencesBatch(
  db: Database,
  userIds: string[],
): Promise<Map<string, BotPreferences>> {
  const out = new Map<string, BotPreferences>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({ id: schema.users.id, preferences: schema.users.preferences })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  for (const r of rows) out.set(r.id, parsePreferences(r.preferences));
  // Users without a row still need a default — the caller may pass user
  // ids that have not yet been provisioned (e.g. test fixtures).
  for (const id of userIds) if (!out.has(id)) out.set(id, DEFAULT_PREFERENCES);
  return out;
}

/**
 * True when `now` falls inside the user's quiet-hours window. Window
 * crossing midnight is supported (e.g. 22:00 → 07:00). Times in the
 * preferences are interpreted in the user's `timezone`. Invalid time
 * strings or unknown timezones return false rather than blocking sends.
 */
export function isInQuietHours(prefs: BotPreferences, now: Date = new Date()): boolean {
  if (!prefs.quietHours.enabled) return false;
  const start = parseHHMM(prefs.quietHours.start);
  const end = parseHHMM(prefs.quietHours.end);
  if (start === null || end === null) return false;

  let hour: number;
  let minute: number;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: prefs.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    // Intl returns "24" for midnight in some browsers; normalize.
    if (hour === 24) hour = 0;
  } catch {
    return false;
  }

  const nowMinutes = hour * 60 + minute;
  const startMinutes = start;
  const endMinutes = end;

  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Window wraps midnight: e.g. 22:00 → 07:00 covers >=22:00 OR <07:00.
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

/**
 * Atomically check + increment per-user push counters against the
 * user's hour/day caps. Used to throttle unsolicited pushes (alerts,
 * digests) so the bot does not flood a user during a noisy market.
 *
 * Returns true when this push is allowed (under both caps); false when
 * one of the caps is already at or above its limit. The counter is only
 * incremented on success, so a rejected push does not "consume" quota.
 *
 * Counters are stored as fixed-bucket keys in Redis with TTL slightly
 * longer than the bucket (60 min / 24 h), so they auto-expire without
 * external cleanup. A bucket is the floor of the current epoch / size.
 *
 * Replies to user-initiated chat messages should NOT call this — the
 * user just typed something, we have to answer them.
 */
export async function recordAndCheckPushQuota(
  redis: Redis,
  userId: string,
  prefs: BotPreferences,
  now: Date = new Date(),
): Promise<boolean> {
  const { maxPerHour, maxPerDay } = prefs.throttling;
  // 0 means "no caps" — let everything through.
  if (maxPerHour <= 0 && maxPerDay <= 0) return true;

  const hourBucket = Math.floor(now.getTime() / (60 * 60_000));
  const dayBucket = Math.floor(now.getTime() / (24 * 60 * 60_000));
  const hourKey = `push:quota:user:${userId}:h:${hourBucket}`;
  const dayKey = `push:quota:user:${userId}:d:${dayBucket}`;

  const allowed = (await redis.eval(
    PUSH_QUOTA_SCRIPT,
    2,
    hourKey,
    dayKey,
    String(maxPerHour),
    String(maxPerDay),
    String(2 * 60 * 60), // hour bucket TTL — 2h gives slack across boundaries
    String(2 * 24 * 60 * 60), // day bucket TTL — 2d gives slack across boundaries
  )) as number;

  return allowed === 1;
}

const PUSH_QUOTA_SCRIPT = `
local hourKey = KEYS[1]
local dayKey = KEYS[2]
local hourLimit = tonumber(ARGV[1])
local dayLimit = tonumber(ARGV[2])
local hourTtl = tonumber(ARGV[3])
local dayTtl = tonumber(ARGV[4])

local hourCount = tonumber(redis.call('GET', hourKey) or '0')
local dayCount = tonumber(redis.call('GET', dayKey) or '0')

if hourLimit > 0 and hourCount >= hourLimit then return 0 end
if dayLimit > 0 and dayCount >= dayLimit then return 0 end

local newHour = redis.call('INCR', hourKey)
if newHour == 1 then redis.call('EXPIRE', hourKey, hourTtl) end
local newDay = redis.call('INCR', dayKey)
if newDay == 1 then redis.call('EXPIRE', dayKey, dayTtl) end
return 1
`;

/**
 * Compute the local hour, minute, day-of-week, and ISO date for a
 * given timezone. Used by the digest scheduler to decide whether the
 * current tick matches the user's chosen digestTime / digestWeekday in
 * their own timezone. Falls back to UTC when the timezone is invalid.
 */
export interface LocalClock {
  hour: number;
  minute: number;
  /** 0=Sunday … 6=Saturday */
  dayOfWeek: number;
  /** YYYY-MM-DD in the local timezone, used as a per-user period key. */
  date: string;
}

const DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getLocalClock(timezone: string, now: Date = new Date()): LocalClock {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    }).formatToParts(now);
  } catch {
    return getLocalClock('UTC', now);
  }
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  return {
    hour,
    minute: Number(get('minute')),
    dayOfWeek: DOW[get('weekday')] ?? 0,
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
