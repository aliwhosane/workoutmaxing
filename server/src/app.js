import Fastify from 'fastify';
import cors from '@fastify/cors';
import { db } from './db.js';
import { verifyProviderToken, upsertUser, recordDevice, issueSession, requireAuth } from './auth.js';
import { push, pull, deleteAccount } from './sync.js';

const env = process.env;

/**
 * Refuses to start on a configuration that would be quietly insecure.
 *
 * Every one of these is a setting whose absence does not break anything
 * visibly — the server boots, sign-in works, sync works — while removing the
 * thing that makes it safe. A missing JWT_SECRET means forged sessions; the
 * placeholder from .env.example means the same, published. Those have to be a
 * startup failure, which is loud, rather than a runtime default, which is not.
 *
 * This lives in buildApp so both entry points get it: index.js starts a
 * listener, lambda.js does not, and only one of them used to check.
 */
function assertConfig() {
  const problems = [];

  const secret = env.JWT_SECRET;
  if (!secret) {
    problems.push('JWT_SECRET is required — sessions cannot be signed without it.');
  } else if (secret === 'replace-me') {
    problems.push('JWT_SECRET is still the placeholder from .env.example.');
  } else if (secret.length < 32) {
    problems.push(
      `JWT_SECRET is ${secret.length} characters; 32 or more are required. Generate one with:\n` +
      '    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    );
  }

  if (!env.DYNAMODB_TABLE) problems.push('DYNAMODB_TABLE is required.');

  // At least one provider has to be usable, or nobody can sign in at all. A
  // provider whose client id is missing is refused per-request in auth.js
  // rather than verified without an audience.
  if (!env.APPLE_CLIENT_ID && !env.GOOGLE_CLIENT_ID) {
    problems.push('At least one of APPLE_CLIENT_ID or GOOGLE_CLIENT_ID must be set.');
  }

  if (problems.length > 0) {
    throw new Error(`Refusing to start:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * A small fixed-window limiter, per client, per route class.
 *
 * Deliberately dependency-free and deliberately modest in what it claims: the
 * counters live in this process, so behind several Lambda containers the real
 * ceiling is this limit times the number of warm instances. That is fine for
 * what it is for — stopping one client from looping on an endpoint that writes
 * to DynamoDB or fetches a provider's JWKS — but a hard guarantee belongs at
 * the edge (API Gateway usage plans, WAF, CloudFront), not here.
 */
function rateLimiter({ limit, windowMs, key }) {
  const hits = new Map();

  return async (req, reply) => {
    const now = Date.now();

    // Bounded cleanup: the map is only ever as large as the clients seen in
    // one window, so an attacker rotating source addresses cannot grow it
    // without limit across windows.
    for (const [k, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(k);
    }

    const id = key(req);
    const entry = hits.get(id);
    if (!entry || entry.resetAt <= now) {
      hits.set(id, { count: 1, resetAt: now + windowMs });
      return;
    }

    entry.count++;
    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return reply
        .code(429)
        .header('retry-after', String(retryAfter))
        .send({ error: 'too many requests', retryAfter });
    }
  };
}

/**
 * Builds the HTTP app.
 *
 * Deliberately separate from starting a server. Running locally this gets a
 * `listen()`; on Lambda the same instance is wrapped by an adapter and never
 * listens on a port at all. Keeping construction free of process concerns is
 * what makes both possible from one definition.
 */
export async function buildApp() {
  assertConfig();

  // 6 MB matches Lambda's hard payload limit. Set higher, a request between
  // the two sizes is rejected by the platform with an opaque error instead of
  // by us with a clear one. The client batches 500 rows per table, which is
  // well under this even for a heavy session.
  const app = Fastify({
    logger: true,
    bodyLimit: 6 * 1024 * 1024,
    // Function URLs and API Gateway put the caller's address in
    // X-Forwarded-For; without this every request rate-limits against the
    // proxy's address instead of the client's.
    trustProxy: true,
  });

  /**
   * CORS is opt-in, because the only client is a native app.
   *
   * A phone does not send an Origin and is not subject to the same-origin
   * policy, so the previous `origin: true` — which reflects whatever origin
   * asks — bought nothing and told every browser on the internet that any page
   * may call this API. Set CORS_ORIGIN to a comma-separated list if a web
   * client is ever added.
   */
  const origins = (env.CORS_ORIGIN ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (origins.length > 0) await app.register(cors, { origin: origins });

  /**
   * Treat an empty JSON body as an empty object.
   *
   * Fastify rejects `content-type: application/json` with no body, which is
   * exactly what a client sends for a bodyless DELETE — most HTTP libraries set
   * the header whether or not there is anything to send. Refusing that is a
   * technicality the caller cannot reasonably be expected to work around.
   */
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '' || body == null) return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  /**
   * One error shape for anything unhandled.
   *
   * Fastify's default puts `err.message` in the 500 body, and the messages
   * that reach here come from the AWS SDK — table names, index names, region
   * and account detail. The client can do nothing with any of it, so it is
   * logged and the caller gets the status alone.
   */
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, 'request failed');
      return reply.code(status).send({ error: 'internal error' });
    }
    return reply.code(status).send({ error: err.message });
  });

  const auth = requireAuth(env.JWT_SECRET);
  const byIp = (req) => req.ip ?? 'unknown';

  // Sign-in is unauthenticated and does RSA verification against a remote
  // JWKS, so it is the cheapest thing here to abuse and the most expensive to
  // serve. Sync is authenticated, so it limits per account rather than per
  // address — one user's phones must not be throttled by another's.
  const signInLimit = rateLimiter({ limit: 20, windowMs: 60_000, key: byIp });
  const syncLimit = rateLimiter({ limit: 60, windowMs: 60_000, key: (req) => req.userId ?? byIp(req) });
  const deleteLimit = rateLimiter({ limit: 5, windowMs: 60_000, key: (req) => req.userId ?? byIp(req) });

  app.get('/health', async () => ({ ok: true }));

  /** Exchange a verified Apple/Google ID token for our own session token. */
  app.post('/auth/session', { preHandler: signInLimit }, async (req, reply) => {
    const { provider, idToken, deviceId } = req.body ?? {};
    if (!provider || !idToken) return reply.code(400).send({ error: 'provider and idToken required' });

    let identity;
    try {
      identity = await verifyProviderToken(provider, idToken, env);
    } catch (err) {
      req.log.warn({ err: err.message }, 'provider token rejected');
      return reply.code(401).send({ error: 'invalid provider token' });
    }

    const user = await upsertUser(identity);

    if (deviceId) await recordDevice(user.userId, deviceId, req.body.platform);

    const token = await issueSession(user.userId, env.JWT_SECRET);
    return { token, userId: user.userId };
  });

  /**
   * The whole sync surface: one endpoint, both directions.
   *
   * Push before pull, in the same request, so a device that changed something and
   * then immediately asks what's new cannot receive a stale copy of its own row.
   */
  app.post('/sync', { preHandler: [auth, syncLimit] }, async (req, reply) => {
    const { since, changes } = req.body ?? {};
    let applied;
    try {
      applied = await push(req.userId, changes);
    } catch (err) {
      // A rejected row is the client's mistake, not ours, and saying which one
      // is what makes it fixable.
      if (err.statusCode === 400) return reply.code(400).send({ error: err.message });
      throw err;
    }
    const result = await pull(req.userId, since);
    return { ...result, applied };
  });

  /**
   * Deletes the account and everything in it.
   *
   * DELETE rather than a POST to /account/delete, because it is exactly what the
   * verb means and there is nothing to negotiate. Authenticated like everything
   * else, and scoped to the caller's own id — there is no route that lets one
   * account name another.
   */
  app.delete('/account', { preHandler: [auth, deleteLimit] }, async (req) => {
    const deleted = await deleteAccount(req.userId);
    req.log.info({ userId: req.userId, deleted }, 'account deleted');
    return { deleted };
  });

  return app;
}
