import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, table, PK } from './db.js';

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

/**
 * Finds or creates the account behind a verified provider identity.
 *
 * The provider subject *is* the user id — "apple:001234.abc" — rather than a
 * generated id mapped to it. It is already globally unique and stable, and
 * using it directly removes a lookup from the hot path of every sync.
 *
 * Note these items deliberately carry no `updatedAt`. A DynamoDB GSI only
 * indexes items that have both of its key attributes, so accounts and devices
 * stay out of the sync index entirely rather than being filtered out of every
 * delta pull.
 */
export async function upsertUser({ subject, email }) {
  const now = Date.now();

  await db().send(new UpdateCommand({
    TableName: table(),
    Key: { [PK]: `user#${subject}` },
    UpdateExpression:
      'SET email = :e, lastSeenAt = :n, createdAt = if_not_exists(createdAt, :n), userId = :u',
    ExpressionAttributeValues: { ':e': email ?? null, ':n': now, ':u': subject },
  }));

  return { userId: subject, subject, email: email ?? null };
}

/**
 * Records a device, so a future "sign out everywhere" has something to revoke.
 *
 * The device id is also added to a set on the account. Device rows carry no
 * `updatedAt` and so are deliberately absent from the sync index, which means
 * there is otherwise no way to enumerate them without scanning the whole table.
 * Account deletion has to find every one of them, and a scan is the wrong price
 * to pay for something that must be exact.
 */
export async function recordDevice(userId, deviceId, platform) {
  const now = Date.now();
  await db().send(new UpdateCommand({
    TableName: table(),
    Key: { [PK]: `device#${userId}#${deviceId}` },
    UpdateExpression:
      'SET platform = :p, lastSeenAt = :n, createdAt = if_not_exists(createdAt, :n), userId = :u',
    ExpressionAttributeValues: { ':p': platform ?? null, ':n': now, ':u': userId },
  }));

  await db().send(new UpdateCommand({
    TableName: table(),
    Key: { [PK]: `user#${userId}` },
    UpdateExpression: 'ADD deviceIds :d',
    ExpressionAttributeValues: { ':d': new Set([deviceId]) },
  }));
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
