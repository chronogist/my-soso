import { z } from 'zod';

/**
 * SoSoValue returns numeric fields as JSON strings ("BigDecimal" /
 * "Long" in their docs) so the envelope is consistent across very
 * large values. We parse them as numbers because Wave 1 only displays
 * them; a future migration to a decimal library would change this in
 * one place.
 */
const numericFromString = z.preprocess((v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}, z.number().finite());

const numericFromStringNullable = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null;
  return v;
}, numericFromString.nullable());

const intFromString = z.preprocess((v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : v;
  }
  return v;
}, z.number().int());

export const CurrencySchema = z.object({
  currency_id: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string().min(1),
});
export type Currency = z.infer<typeof CurrencySchema>;

export const CurrencyListSchema = z.array(CurrencySchema);

export const MarketSnapshotSchema = z.object({
  price: numericFromString,
  change_pct_24h: numericFromStringNullable,
  turnover_24h: numericFromStringNullable,
  high_24h: numericFromStringNullable,
  low_24h: numericFromStringNullable,
  marketcap: numericFromStringNullable,
  fdv: numericFromStringNullable,
  marketcap_rank: z.number().int().nullable().optional(),
});
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;

const MatchedCurrencySchema = z
  .object({
    symbol: z.string().optional(),
    currency_id: z.string().optional(),
  })
  .passthrough();

export const NewsItemSchema = z.object({
  id: z.string().min(1),
  source_link: z.string().url().nullable().optional(),
  original_link: z.string().url().nullable().optional(),
  /** SoSoValue reports release_time as epoch milliseconds, sometimes as a string. */
  release_time: intFromString,
  /** Some feed items have a null title; we filter them out at the mapper. */
  title: z.string().nullable(),
  content: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  matched_currencies: z.array(MatchedCurrencySchema).optional(),
});
export type NewsItemRaw = z.infer<typeof NewsItemSchema>;

export const NewsListSchema = z.object({
  page: intFromString.nullable().optional(),
  page_size: intFromString.nullable().optional(),
  total: intFromString.nullable().optional(),
  list: z.array(NewsItemSchema),
});
export type NewsList = z.infer<typeof NewsListSchema>;
