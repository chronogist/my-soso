import { createPublicKey, verify } from 'node:crypto';

export const DISCORD_SIGNATURE_HEADER = 'x-signature-ed25519';
export const DISCORD_TIMESTAMP_HEADER = 'x-signature-timestamp';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function discordKeyObject(publicKeyHex: string) {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

export function verifyDiscordSignature(opts: {
  publicKey: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  rawBody: string;
}): boolean {
  if (!opts.signature || !opts.timestamp) return false;

  try {
    return verify(
      null,
      Buffer.from(opts.timestamp + opts.rawBody),
      discordKeyObject(opts.publicKey),
      Buffer.from(opts.signature, 'hex'),
    );
  } catch {
    return false;
  }
}
