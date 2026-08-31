import Fastify from 'fastify';
import cors from '@fastify/cors';
import { db } from './db.js';
import { verifyProviderToken, upsertUser, recordDevice, issueSession, requireAuth } from './auth.js';
import { push, pull, deleteAccount } from './sync.js';

const env = process.env;

/**
 * Builds the HTTP app.
 *
 * Deliberately separate from starting a server. Running locally this gets a
 * `listen()`; on Lambda the same instance is wrapped by an adapter and never
 * listens on a port at all. Keeping construction free of process concerns is
 * what makes both possible from one definition.
 */
export async function buildApp() {
  // 6 MB matches Lambda's hard payload limit. Set higher, a request between
  // the two sizes is rejected by the platform with an opaque error instead of
  // by us with a clear one. The client batches 500 rows per table, which is
  // well under this even for a heavy session.
  const app = Fastify({ logger: true, bodyLimit: 6 * 1024 * 1024 });
  await app.register(cors, { origin: true });

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

  const auth = requireAuth(env.JWT_SECRET);

  app.get('/health', async () => ({ ok: true }));

  /** Exchange a verified Apple/Google ID token for our own session token. */
  app.post('/auth/session', async (req, reply) => {
    const { provider, idToken, deviceId } = req.body ?? {};
    if (!provider || !idToken) return reply.code(400).send({ error: 'provider and idToken required' });

    let identity;
    try {
      identity = await verifyProviderToken(provider, idToken, env);
    } catch (err) {
      req.log.warn({ err }, 'provider token rejected');
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
  app.post('/sync', { preHandler: auth }, async (req) => {
    const { since, changes } = req.body ?? {};
    const applied = await push(req.userId, changes);
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
  app.delete('/account', { preHandler: auth }, async (req) => {
    const deleted = await deleteAccount(req.userId);
    req.log.info({ userId: req.userId, deleted }, 'account deleted');
    return { deleted };
  });

  return app;
}
