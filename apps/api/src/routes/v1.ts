import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomInt } from 'node:crypto';
import { createDb, schema, withServiceContext, withTenantUser, type Database } from '@my-soso/db';
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
const WatchlistItemSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9._-]+$/),
  assetKind: z.string().trim().min(1).max(32).default('crypto'),
});

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

  const [user] = await withServiceContext(db, async (tx) =>
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
          email,
          walletAddress: input.walletAddress,
        },
      })
      .returning(),
  );

  if (!user) throw new Error('failed to upsert user');
  await ensureDefaultWatchlist(db, user.id);
  return user;
}

async function loadUserForPrivy(db: Database, claims: VerifiedPrivyClaims) {
  const [user] = await withServiceContext(db, async (tx) =>
    tx.select().from(schema.users).where(eq(schema.users.privyUserId, claims.privyUserId)).limit(1),
  );
  return user ?? upsertUserForPrivy(db, claims, {});
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
    createdAt: user.createdAt.toISOString(),
  };
}

export function registerV1Routes(
  app: FastifyInstance,
  {
    config,
    verifier,
    redis,
  }: {
    config: Config;
    verifier: PrivyVerifier;
    redis: Redis;
  },
): void {
  const db = createDb({ url: config.DATABASE_URL });

  app.addHook('onClose', async () => {
    // postgres-js closes when the process exits; Drizzle does not currently
    // expose the client through our Database wrapper. Keep this hook reserved.
  });

  app.post('/v1/session', async (req) => {
    const claims = await requireAuth(req, verifier);
    const input = SessionSyncSchema.parse(req.body ?? {});
    const user = await upsertUserForPrivy(db, claims, input);
    return { user: publicUser(user) };
  });

  app.get('/v1/me', async (req) => {
    const claims = await requireAuth(req, verifier);
    const user = await loadUserForPrivy(db, claims);
    return { user: publicUser(user) };
  });

  app.post('/v1/link-codes', async (req) => {
    const claims = await requireAuth(req, verifier);
    const user = await loadUserForPrivy(db, claims);
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
    const user = await loadUserForPrivy(db, claims);
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
    const user = await loadUserForPrivy(db, claims);
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
    const user = await loadUserForPrivy(db, claims);
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
    const user = await loadUserForPrivy(db, claims);
    const params = z.object({ symbol: z.string().min(1) }).parse(req.params);

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
}
