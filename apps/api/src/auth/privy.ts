import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { FastifyRequest } from 'fastify';

export interface VerifiedPrivyClaims {
  privyUserId: string;
  sessionId: string | null;
}

export interface PrivyVerifier {
  verifyRequest: (req: FastifyRequest) => Promise<VerifiedPrivyClaims>;
}

function extractBearer(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw Object.assign(new Error('missing bearer token'), { statusCode: 401 });
  }
  return header.slice('Bearer '.length).trim();
}

function normalizePem(value: string): string {
  return value.includes('\\n') ? value.replaceAll('\\n', '\n') : value;
}

export async function createPrivyVerifier({
  appId,
  verificationKey,
  jwksUrl,
}: {
  appId: string;
  verificationKey?: string | undefined;
  jwksUrl?: string | undefined;
}): Promise<PrivyVerifier> {
  // Prefer JWKS so Privy key rotation doesn't require a redeploy.
  // Fall back to a static SPKI for environments that pin a key.
  let getKey: JWTVerifyGetKey | Awaited<ReturnType<typeof importSPKI>>;
  if (jwksUrl) {
    getKey = createRemoteJWKSet(new URL(jwksUrl), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
  } else if (verificationKey) {
    getKey = await importSPKI(normalizePem(verificationKey), 'ES256');
  } else {
    throw new Error('Privy verifier requires either jwksUrl or verificationKey');
  }

  return {
    verifyRequest: async (req) => {
      const token = extractBearer(req);
      const { payload } = await jwtVerify(token, getKey as Parameters<typeof jwtVerify>[1], {
        issuer: 'privy.io',
        audience: appId,
      });

      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw Object.assign(new Error('invalid auth subject'), { statusCode: 401 });
      }

      return {
        privyUserId: payload.sub,
        sessionId: typeof payload.sid === 'string' ? payload.sid : null,
      };
    },
  };
}
