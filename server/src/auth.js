import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import { db } from './db.js';

const enc = new TextEncoder();

/**
 * Identity providers.
 *
 * Sign in with Apple on iOS and Google on Android are the two the platforms
 * already trust, so the user never types a password and we never store one.
 * Both hand us a signed ID token; we verify it against the provider's public
 * keys and mint our own short session token from the result.
 */
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export async function verifyProviderToken(provider, idToken, env) {
  if (provider === 'apple') {
    const { payload } = await jwtVerify(idToken, APPLE_JWKS, {
      issuer: 'https://appleid.apple.com',
      audience: env.APPLE_CLIENT_ID,
    });
    return { subject: `apple:${payload.sub}`, email: payload.email ?? null };
  }
  if (provider === 'google') {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env.GOOGLE_CLIENT_ID,
    });
    return { subject: `google:${payload.sub}`, email: payload.email ?? null };
  }
  throw new Error(`unknown provider: ${provider}`);
}

/** Finds or creates the account behind a verified provider identity. */
export async function upsertUser({ subject, email }) {
  const users = db().collection('users');
  const now = new Date();
  await users.updateOne(
    { subject },
    { $set: { subject, email, lastSeenAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  return users.findOne({ subject });
}

export const issueSession = (userId, secret) =>
  new SignJWT({ uid: String(userId) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('90d')
    .sign(enc.encode(secret));

/**
 * Fastify preHandler. Attaches req.userId or refuses the request — every sync
 * route is scoped to one user and there is no route that reads across users.
 */
export function requireAuth(secret) {
  return async (req, reply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return reply.code(401).send({ error: 'missing token' });
    try {
      const { payload } = await jwtVerify(token, enc.encode(secret));
      req.userId = payload.uid;
    } catch {
      return reply.code(401).send({ error: 'invalid token' });
    }
  };
}
