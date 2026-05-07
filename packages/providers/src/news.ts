import type { NewsItem } from './types.js';

export interface NewsProvider {
  readonly name: string;

  /**
   * Most recent items tagged to a specific asset symbol. `limit` is a
   * soft cap; providers may return fewer.
   */
  getNewsForAsset(symbol: string, opts?: { limit?: number }): Promise<readonly NewsItem[]>;

  /**
   * Latest market-wide headlines, not filtered by asset. Used by the
   * prefetcher to warm the digest cache and by the alert engine for
   * relevance scoring.
   */
  getLatestNews(opts?: { limit?: number }): Promise<readonly NewsItem[]>;
}
