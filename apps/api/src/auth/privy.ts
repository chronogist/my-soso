import { importSPKI, jwtVerify } from 'jose';
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
}: {
  appId: string;
  verificationKey: string;
}): Promise<PrivyVerifier> {
  const key = await importSPKI(normalizePem(verificationKey), 'ES256');

  return {
    verifyRequest: async (req) => {
      const token = extractBearer(req);
      const { payload } = await jwtVerify(token, key, {
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
