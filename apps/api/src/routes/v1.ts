import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomInt } from 'node:crypto';
import { schema, withServiceContext, withTenantUser, type Database } from '@my-soso/db';
import type { Redis } from '@my-soso/queue';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { PrivyVerifier, VerifiedPrivyClaims } from '../auth/privy.js';

const ChannelSchema = z.enum(['telegram', 'discord', 'whatsapp']);
const SessionSyncSchema = z.object({
  email: z.string().email().optional(),
  walletAddress: z.string().min(1).optional(),
});
const LinkCodeSchema = z.object({ channel: ChannelSchema });
const DigestScheduleSchema = z.enum(['off', 'daily', 'weekly']);
const SymbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9._-]+$/);

const WatchlistItemSchema = z.object({
  symbol: SymbolSchema,
  assetKind: z.string().trim().min(1).max(32).default('crypto'),
});
const AlertIdParamsSchema = z.object({ id: z.string().uuid() });
const PriceOpSchema = z.enum(['lt', 'lte', 'gt', 'gte']);
const CreateAlertSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('price'),
    symbol: SymbolSchema,
    op: PriceOpSchema,
    threshold: z.coerce.number().positive(),
    name: z.string().trim().min(1).max(80).optional(),
    assetKind: z.string().trim().min(1).max(32).default('crypto'),
  }),
  z.object({
    kind: z.literal('news'),
    symbol: SymbolSchema,
    name: z.string().trim().min(1).max(80).optional(),
    assetKind: z.string().trim().min(1).max(32).default('crypto'),
  }),
]);
const UpdateAlertSchema = z
  .object({
    active: z.boolean().optional(),
    name: z.string().trim().min(1).max(80).optional(),
  })
  .refine((input) => input.active !== undefined || input.name !== undefined, {
    message: 'Provide at least one alert field to update',
  });
const DigestPreferenceSchema = z.object({ schedule: DigestScheduleSchema });

const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateLinkCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += LINK_ALPHABET[randomInt(LINK_ALPHABET.length)];
  }
  return code;
}

function fallbackEmail(privyUserId: string): string {
  const safe = privyUserId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${safe || 'user'}@privy.local`;
}

async function requireAuth(
  req: FastifyRequest,
  verifier: PrivyVerifier,
): Promise<VerifiedPrivyClaims> {
  try {
    return await verifier.verifyRequest(req);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    throw Object.assign(e, { statusCode: 401 });
  }
}

async function upsertUserForPrivy(
  db: Database,
  claims: VerifiedPrivyClaims,
  input: z.infer<typeof SessionSyncSchema>,
) {
  const email = input.email ?? fallbackEmail(claims.privyUserId);

  // Email is set on creation only — the API cannot independently verify a
  // client-supplied email, so we don't let subsequent /v1/session calls
  // overwrite it. Wallet address is filled in once the embedded wallet is
  // ready, but never changed thereafter.
  let user;
  try {
    [user] = await withServiceContext(db, async (tx) =>
      tx
        .insert(schema.users)
        .values({
          privyUserId: claims.privyUserId,
          email,
          walletAddress: input.walletAddress,
        })
        .onConflictDoUpdate({
          target: schema.users.privyUserId,
          set: {
            walletAddress: sql`coalesce(${schema.users.walletAddress}, excluded.wallet_address)`,
          },
        })
        .returning(),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/duplicate key.*users_email_unique|users_email_key/i.test(msg)) {
      throw Object.assign(new Error('email already in use'), { statusCode: 409 });
    }
    throw err;
  }

  if (!user) throw new Error('failed to upsert user');
  await ensureDefaultWatchlist(db, user.id);
  return user;
}

async function requireUserForPrivy(db: Database, claims: VerifiedPrivyClaims) {
  const [user] = await withServiceContext(db, async (tx) =>
    tx.select().from(schema.users).where(eq(schema.users.privyUserId, claims.privyUserId)).limit(1),
  );
  if (!user) {
    throw Object.assign(new Error('user not provisioned; call /v1/session first'), {
      statusCode: 404,
    });
  }
  return user;
}

async function ensureDefaultWatchlist(db: Database, userId: string) {
  const [existing] = await withTenantUser(db, userId, async (tx) =>
    tx
      .select()
      .from(schema.watchlists)
      .where(and(eq(schema.watchlists.userId, userId), eq(schema.watchlists.isDefault, true)))
      .limit(1),
  );
  if (existing) return existing;

  const [created] = await withTenantUser(db, userId, async (tx) =>
    tx
      .insert(schema.watchlists)
      .values({ userId, name: 'Default', isDefault: true })
      .onConflictDoNothing()
      .returning(),
  );

  if (created) return created;

  const [fallback] = await withTenantUser(db, userId, async (tx) =>
    tx
      .select()
      .from(schema.watchlists)
      .where(and(eq(schema.watchlists.userId, userId), eq(schema.watchlists.name, 'Default')))
      .limit(1),
  );
  if (!fallback) throw new Error('failed to ensure default watchlist');
  return fallback;
}

function publicUser(user: typeof schema.users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    privyUserId: user.privyUserId,
    walletAddress: user.walletAddress,
    plan: user.plan,
    digestSchedule: user.digestSchedule,
    createdAt: user.createdAt.toISOString(),
  };
}

function publicAlert(alert: typeof schema.alerts.$inferSelect) {
  return {
    id: alert.id,
    name: alert.name,
    kind: alert.kind,
    symbol: alert.assetSymbol,
    assetKind: alert.assetKind,
    priceOp: alert.priceOp,
    priceThreshold: alert.priceThreshold !== null ? Number(alert.priceThreshold) : null,
    active: alert.active,
    createdAt: alert.createdAt.toISOString(),
    lastFiredAt: alert.lastFiredAt?.toISOString() ?? null,
  };
}

function defaultAlertName(input: z.infer<typeof CreateAlertSchema>, symbol: string) {
  if (input.name) return input.name;
  if (input.kind === 'news') return `${symbol} breaking news`;
  const direction = input.op === 'lt' || input.op === 'lte' ? 'drops below' : 'rises above';
  return `${symbol} ${direction} $${input.threshold}`;
}

export function registerV1Routes(
  app: FastifyInstance,
  {
    config,
    verifier,
    redis,
    db,
  }: {
    config: Config;
    verifier: PrivyVerifier;
    redis: Redis;
    db: Database;
  },
): void {
  app.post('/v1/session', async (req) => {
    const claims = await requireAuth(req, verifier);
    const input = SessionSyncSchema.parse(req.body ?? {});
    const user = await upsertUserForPrivy(db, claims, input);
    return { user: publicUser(user) };
  });

  app.get('/v1/me', async (req) => {
    const claims = await requireAuth(req, verifier);
    const user = await requireUserForPrivy(db, claims);
    return { user: publicUser(user) };
  });

  app.post('/v1/link-codes', async (req) => {
    const claims = await requireAuth(req, verifier);
    const user = await requireUserForPrivy(db, claims);
    const { channel } = LinkCodeSchema.parse(req.body ?? {});

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateLinkCode();
      const ok = await redis.set(
        `link_code:${code}`,
        JSON.stringify({ userId: user.id, channel, createdAt: new Date().toISOString() }),
        'EX',
        config.LINK_CODE_TTL_SECONDS,
        'NX',
      );
      if (ok === 'OK') {
        return {
          code,
          channel,
          command: `/link ${code}`,
          expiresInSeconds: config.LINK_CODE_TTL_SECONDS,
        };
      }
    }

    throw Object.assign(new Error('could not allocate link code'), { statusCode: 503 });
  });

  app.get('/v1/channel-links', async (req) => {
    const claims = await requireAuth(req, verifier);
    const user = await requireUserForPrivy(db, claims);
    const links = await withTenantUser(db, user.id, async (tx) =>
      tx
        .select()
        .from(schema.channelLinks)
        .where(eq(schema.channelLinks.userId, user.id))
        .orderBy(schema.channelLinks.linkedAt),
    );

    return {
      links: links.map((link) => ({
        id: link.id,
        channel: link.channel,
        channelUserId: link.channelUserId,
        linkedAt: link.linkedAt.toISOString(),
      })),
    };
  });

  app.get('/v1/watchlist', async (req) => {
    const claims = await requireAuth(req, verifier);
    const user = await requireUserForPrivy(db, claims);
    const watchlist = await ensureDefaultWatchlist(db, user.id);
    const items = await withTenantUser(db, user.id, async (tx) =>
      tx
        .select()
        .from(schema.watchlistItems)
        .where(eq(schema.watchlistItems.watchlistId, watchlist.id))
        .orderBy(schema.watchlistItems.createdAt),
    );

    return {
      watchlist: {
        id: watchlist.id,
        name: watchlist.name,
        isDefault: watchlist.isDefault,
        items: items.map((item) => ({
          id: item.id,
          symbol: item.assetSymbol,
          assetKind: item.assetKind,
          createdAt: item.createdAt.toISOString(),
        })),
      },
    };
  });

  app.post('/v1/watchlist/items', async (req) => {
    const claims = await requireAuth(req, verifier);
    const user = await requireUserForPrivy(db, claims);
    const watchlist = await ensureDefaultWatchlist(db, user.id);
    const input = WatchlistItemSchema.parse(req.body ?? {});
    const symbol = input.symbol.toUpperCase();

    await withTenantUser(db, user.id, async (tx) =>
      tx
        .insert(schema.watchlistItems)
        .values({
          userId: user.id,
          watchlistId: watchlist.id,
          assetSymbol: symbol,
          assetKind: input.assetKind,
        })
        .onConflictDoNothing(),
    );

    return { ok: true };
  });

  app.delete('/v1/watchlist/items/:symbol', async (req, reply) => {
    const claims = await requireAuth(req, verifier);
    const user = await requireUserForPrivy(db, claims);
    const params = z.object({ symbol: SymbolSchema }).parse(req.params);

    await withTenantUser(db, user.id, async (tx) =>
      tx
        .delete(schema.watchlistItems)
        .where(
          and(
            eq(schema.watchlistItems.userId, user.id),
            eq(schema.watchlistItems.assetSymbol, params.symbol.toUpperCase()),
          ),
        ),
    );

    return reply.status(204).send();
  });

  app.get('/v1/alerts', async (req) => {
    const claims = await requireAuth(req, verifier);
    const user = await requireUserForPrivy(db, claims);
    const alerts = await withTenantUser(db, user.id, async (tx) =>
      tx
        .select()
        .from(schema.alerts)
        .where(eq(schema.alerts.userId, user.id))
        .orderBy(schema.alerts.createdAt),
    );

    return { alerts: alerts.map(publicAlert) };
  });

  app.post('/v1/alerts', async (req) => {
    const claims = await requireAuth(req, verifier);
    const user = await requireUserForPrivy(db, claims);
    const input = CreateAlertSchema.parse(req.body ?? {});
    const symbol = input.symbol.toUpperCase();

    const [alert] = await withTenantUser(db, user.id, async (tx) =>
      tx
        .insert(schema.alerts)
        .values({
          userId: user.id,
          name: defaultAlertName(input, symbol),
          kind: input.kind,
          assetSymbol: symbol,
          assetKind: input.assetKind,
          priceOp: input.kind === 'price' ? input.op : null,
          priceThreshold: input.kind === 'price' ? input.threshold.toString() : null,
          active: true,
        })
        .returning(),
    );

    if (!alert) throw new Error('failed to create alert');
    return { alert: publicAlert(alert) };
  });

  app.patch('/v1/alerts/:id', async (req) => {
    const claims = await requireAuth(req, verifier);
    const user = await requireUserForPrivy(db, claims);
    const params = AlertIdParamsSchema.parse(req.params);
    const input = UpdateAlertSchema.parse(req.body ?? {});

    const [alert] = await withTenantUser(db, user.id, async (tx) =>
      tx
        .update(schema.alerts)
        .set(input)
        .where(and(eq(schema.alerts.userId, user.id), eq(schema.alerts.id, params.id)))
        .returning(),
    );

    if (!alert) {
      throw Object.assign(new Error('alert not found'), { statusCode: 404 });
    }
    return { alert: publicAlert(alert) };
  });

  app.delete('/v1/alerts/:id', async (req, reply) => {
    const claims = await requireAuth(req, verifier);
    const user = await requireUserForPrivy(db, claims);
    const params = AlertIdParamsSchema.parse(req.params);

    await withTenantUser(db, user.id, async (tx) =>
      tx
        .delete(schema.alerts)
        .where(and(eq(schema.alerts.userId, user.id), eq(schema.alerts.id, params.id))),
    );

    return reply.status(204).send();
  });

  app.get('/v1/digest-preferences', async (req) => {
    const claims = await requireAuth(req, verifier);
    const user = await requireUserForPrivy(db, claims);
    return { schedule: user.digestSchedule };
  });

  app.put('/v1/digest-preferences', async (req) => {
    const claims = await requireAuth(req, verifier);
    const user = await requireUserForPrivy(db, claims);
    const input = DigestPreferenceSchema.parse(req.body ?? {});

    const [updated] = await withTenantUser(db, user.id, async (tx) =>
      tx
        .update(schema.users)
        .set({ digestSchedule: input.schedule })
        .where(eq(schema.users.id, user.id))
        .returning({ digestSchedule: schema.users.digestSchedule }),
    );

    if (!updated) throw new Error('failed to update digest preferences');
    return { schedule: updated.digestSchedule };
  });
}
