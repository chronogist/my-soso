/**
 * Header Telegram echoes back on every webhook request. We compare it
 * against the secret we provided when calling `setWebhook`, in constant
 * time. If it doesn't match, the request is forged.
 */
export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Constant-time string compare to defeat timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export interface VerifyTelegramSecretOptions {
  /** Header value as received (case-insensitive lookup happens upstream). */
  received: string | undefined;
  /** Secret configured when calling Telegram's setWebhook. */
  expected: string;
}

export function verifyTelegramSecret({ received, expected }: VerifyTelegramSecretOptions): boolean {
  if (typeof received !== 'string' || received.length === 0) return false;
  if (expected.length === 0) return false;
  return timingSafeEqual(received, expected);
}
