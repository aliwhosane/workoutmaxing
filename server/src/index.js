import Fastify from 'fastify';
import cors from '@fastify/cors';
import { connect, close, db } from './db.js';
import { verifyProviderToken, upsertUser, issueSession, requireAuth } from './auth.js';
import { push, pull } from './sync.js';

const env = process.env;
const PORT = Number(env.PORT ?? 8080);

if (!env.MONGODB_URI || !env.JWT_SECRET) {
  console.error('MONGODB_URI and JWT_SECRET are required. See .env.example.');
  process.exit(1);
}

const app = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });
await app.register(cors, { origin: true });

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

  // Devices are recorded so a future "sign out everywhere" has something to
  // revoke, and so support can tell which phone last wrote a given row.
  if (deviceId) {
    await db().collection('devices').updateOne(
      { userId: String(user._id), deviceId },
      {
        $set: { platform: req.body.platform ?? null, lastSeenAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  }

  const token = await issueSession(user._id, env.JWT_SECRET);
  return { token, userId: String(user._id) };
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

const shutdown = async () => { await app.close(); await close(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await connect(env.MONGODB_URI, env.MONGODB_DB ?? 'workoutmaxing');
await app.listen({ port: PORT, host: '0.0.0.0' });
