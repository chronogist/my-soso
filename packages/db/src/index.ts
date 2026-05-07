export { createDb, closeDb, withServiceContext, withTenantUser, healthCheck } from './client.js';
export type { Database, CreateDbOptions } from './client.js';
export * as schema from './schema.js';
export type {
  User,
  NewUser,
  ChannelLink,
  NewChannelLink,
  Watchlist,
  NewWatchlist,
  WatchlistItem,
  NewWatchlistItem,
} from './schema.js';
