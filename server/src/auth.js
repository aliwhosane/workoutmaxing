import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
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

/**
 * Per-provider verification parameters.
 *
 * `audienceEnv` is the important one. An ID token says "this person is who
 * they claim" but *also* "this token was minted for that app", and only the
 * second half stops it being replayed here. Any other app using Sign in with
 * Apple receives tokens carrying the same `sub` we key accounts on, so without
 * an audience check, whoever runs that app can hand us their users' tokens and
 * be issued our sessions for those users' accounts.
 */
const PROVIDERS = {
  apple: {
    jwks: APPLE_JWKS,
    issuer: 'https://appleid.apple.com',
    audienceEnv: 'APPLE_CLIENT_ID',
  },
  google: {
    jwks: GOOGLE_JWKS,
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audienceEnv: 'GOOGLE_CLIENT_ID',
  },
};

/**
 * A provider subject becomes part of every row's primary key (see `rowKey`),
 * which is a composite joined on `#`. Nothing either provider issues today
 * contains one, but a subject that did could address rows outside its own
 * namespace, so the shape is checked rather than assumed.
 */
const SUBJECT_RE = /^[A-Za-z0-9._:-]{1,255}$/;

export async function verifyProviderToken(provider, idToken, env) {
  const config = Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : null;
  if (!config) throw new Error(`unknown provider: ${provider}`);
  if (typeof idToken !== 'string' || idToken.length === 0 || idToken.length > 8192) {
    throw new Error('malformed id token');
  }

  /**
   * Fail closed when the audience is not configured.
   *
   * `jose` skips the check entirely when `audience` is undefined rather than
   * refusing, so an unset APPLE_CLIENT_ID/GOOGLE_CLIENT_ID would silently turn
   * this into "any valid token from this provider, for any app". A missing
   * client id has to be an outage, never a downgrade.
   */
  const audience = env[config.audienceEnv];
  if (!audience) {
    throw new Error(`${config.audienceEnv} is not configured; refusing ${provider} sign-in`);
  }

  const { payload } = await jwtVerify(idToken, config.jwks, {
    issuer: config.issuer,
    audience,
    // Both providers sign with RS256. Pinning it means a future key served in
    // the JWKS under a weaker algorithm cannot be used to downgrade this.
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'iat', 'exp'],
  });

  if (typeof payload.sub !== 'string' || !SUBJECT_RE.test(payload.sub)) {
    throw new Error('token subject is missing or malformed');
  }

  const email = typeof payload.email === 'string' ? payload.email.slice(0, 320) : null;
  return { subject: `${provider}:${payload.sub}`, email };
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
 *
 * The id is client-supplied, so it is bounded and its shape checked before it
 * reaches a key: it is concatenated into one, and a caller able to send an
 * unbounded string could otherwise grow the account row without limit.
 */
const DEVICE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

export const isValidDeviceId = (id) => typeof id === 'string' && DEVICE_ID_RE.test(id);

export async function recordDevice(userId, deviceId, platform) {
  if (!isValidDeviceId(deviceId)) return;
  const safePlatform = typeof platform === 'string' ? platform.slice(0, 32) : null;
  const now = Date.now();

  await db().send(new UpdateCommand({
    TableName: table(),
    Key: { [PK]: `device#${userId}#${deviceId}` },
    UpdateExpression:
      'SET platform = :p, lastSeenAt = :n, createdAt = if_not_exists(createdAt, :n), userId = :u',
    ExpressionAttributeValues: { ':p': safePlatform, ':n': now, ':u': userId },
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
 *
 * The algorithm is pinned and the claim re-checked against the same shape the
 * provider subject had to satisfy. `uid` ends up inside every DynamoDB key this
 * request touches, so "verified signature" is not on its own enough to let it
 * through unexamined.
 */
export function requireAuth(secret) {
  const key = enc.encode(secret);

  return async (req, reply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return reply.code(401).send({ error: 'missing token' });

    let payload;
    try {
      ({ payload } = await jwtVerify(token, key, { algorithms: ['HS256'] }));
    } catch {
      return reply.code(401).send({ error: 'invalid token' });
    }

    const uid = payload.uid;
    if (typeof uid !== 'string' || !/^(apple|google):/.test(uid) || uid.length > 300) {
      return reply.code(401).send({ error: 'invalid token' });
    }
    req.userId = uid;
  };
}
