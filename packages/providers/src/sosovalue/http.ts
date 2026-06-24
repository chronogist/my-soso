import { z } from 'zod';
import { ProviderUnavailableError, RateLimitedError } from '../types.js';

/**
 * SoSoValue REST envelopes every successful response in
 * `{ code: 0, message, data }`. Non-zero `code` means the request
 * was accepted but rejected at the application layer — wrong key,
 * unknown id, etc.
 */
const EnvelopeSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z.unknown(),
});

export interface SoSoValueHttpOptions {
  /** Override the base URL when targeting a sandbox or proxy. */
  baseUrl?: string;
  apiKey: string;
  /** Per-request timeout. Defaults to 8s. */
  timeoutMs?: number;
  /** Hook for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export type SoSoValueErrorMapper = (params: {
  status: number;
  code: number | null;
  message: string;
}) => Error;

export const DEFAULT_BASE_URL = 'https://openapi.sosovalue.com/openapi/v1';
const PROVIDER_NAME = 'sosovalue';

/**
 * Thin HTTP client. Owns: auth header, timeouts, envelope unwrap,
 * status-code → typed-error mapping. Does NOT own: caching, rate
 * limiting, budget tracking — those compose at a higher layer so
 * this client stays trivially testable.
 */
export class SoSoValueHttp {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(opts: SoSoValueHttpOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 8_000;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Typed GET request against the SoSoValue REST API.
   *
   * 1. Builds URL with optional query params, sets auth header + timeout.
   * 2. Maps HTTP status: 429 → RateLimitedError, 5xx → ProviderUnavailableError.
   * 3. Unwraps the SoSoValue envelope `{ code, message, data }`.
   * 4. Validates `data` against the supplied Zod schema.
   *
   * Throws typed ProviderError subtypes for all failure modes so the
   * composed layer can decide retry vs. fallback vs. surface-to-user.
   */
  async get<T>(
    path: string,
    schema: z.ZodType<T>,
    query?: Readonly<Record<string, string | number | undefined>>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchFn(url.toString(), {
        method: 'GET',
        headers: {
          'x-soso-api-key': this.apiKey,
          accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (cause) {
      throw new ProviderUnavailableError(`network error calling ${path}`, {
        provider: PROVIDER_NAME,
        cause,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
      throw new RateLimitedError(`SoSoValue 429 on ${path}`, {
        provider: PROVIDER_NAME,
        ...(retryAfterMs ? { retryAfterMs } : {}),
      });
    }

    if (res.status >= 500) {
      throw new ProviderUnavailableError(`SoSoValue ${res.status} on ${path}`, {
        provider: PROVIDER_NAME,
      });
    }

    let raw: unknown;
    try {
      raw = await res.json();
    } catch (cause) {
      throw new ProviderUnavailableError(`SoSoValue returned non-JSON for ${path}`, {
        provider: PROVIDER_NAME,
        cause,
      });
    }

    const envelope = EnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      throw new ProviderUnavailableError(`SoSoValue envelope unparseable for ${path}`, {
        provider: PROVIDER_NAME,
        cause: envelope.error,
      });
    }

    if (envelope.data.code !== 0) {
      const message = envelope.data.message ?? 'unknown SoSoValue error';
      const err = new Error(`SoSoValue ${envelope.data.code}: ${message}`);
      Object.assign(err, {
        provider: PROVIDER_NAME,
        code: envelope.data.code,
        path,
      });
      throw err;
    }

    const parsed = schema.safeParse(envelope.data.data);
    if (!parsed.success) {
      throw new ProviderUnavailableError(`SoSoValue payload schema mismatch on ${path}`, {
        provider: PROVIDER_NAME,
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}
