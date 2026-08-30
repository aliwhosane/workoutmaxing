import Fastify from 'fastify';
import cors from '@fastify/cors';
import { connect, close } from './db.js';
import { verifyProviderToken, upsertUser, recordDevice, issueSession, requireAuth } from './auth.js';
import { push, pull } from './sync.js';

const env = process.env;
const PORT = Number(env.PORT ?? 8080);

if (!env.DYNAMODB_TABLE || !env.JWT_SECRET) {
  console.error('DYNAMODB_TABLE and JWT_SECRET are required. See .env.example.');
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

const shutdown = async () => { await app.close(); await close(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

/**
 * Fail with something a person can act on. The SDK's own errors for a missing
 * credential or an absent table are stack traces into its internals, which say
 * nothing about what to do next.
 */
try {
  await connect(env.DYNAMODB_TABLE, env.AWS_REGION ?? 'us-east-1');
} catch (err) {
  const name = err?.name ?? '';
  if (name === 'CredentialsProviderError') {
    console.error(
      'No AWS credentials found.\n' +
      '  Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in server/.env,\n' +
      '  or configure a profile (aws configure / aws sso login).',
    );
  } else if (name === 'ResourceNotFoundException') {
    console.error(
      `Table "${env.DYNAMODB_TABLE}" not found in ${env.AWS_REGION ?? 'us-east-1'}.\n` +
      '  Check DYNAMODB_TABLE and AWS_REGION in server/.env.',
    );
  } else if (name === 'AccessDeniedException' || name === 'UnrecognizedClientException') {
    console.error(
      'AWS rejected those credentials for this table.\n' +
      '  The server needs dynamodb:DescribeTable, UpdateTable, Query,\n' +
      '  BatchWriteItem, GetItem and UpdateItem on it.',
    );
  } else {
    console.error('Could not reach DynamoDB:', err?.message ?? err);
  }
  process.exit(1);
}
await app.listen({ port: PORT, host: '0.0.0.0' });
