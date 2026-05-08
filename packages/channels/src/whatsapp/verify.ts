import { createHmac, timingSafeEqual } from 'node:crypto';

export const WHATSAPP_SIGNATURE_HEADER = 'x-hub-signature-256';

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyWhatsAppSignature(opts: {
  appSecret: string;
  signature: string | null | undefined;
  rawBody: string;
}): boolean {
  if (!opts.appSecret || !opts.signature) return false;
  const [prefix, actual] = opts.signature.split('=');
  if (prefix !== 'sha256' || !actual) return false;

  const expected = createHmac('sha256', opts.appSecret).update(opts.rawBody).digest('hex');
  return safeEqualHex(expected, actual);
}

export function verifyWhatsAppChallenge(opts: {
  mode: string | undefined;
  verifyToken: string | undefined;
  expectedToken: string;
}): boolean {
  return opts.mode === 'subscribe' && !!opts.verifyToken && opts.verifyToken === opts.expectedToken;
}
