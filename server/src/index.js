import { buildApp } from './app.js';
import { connect, close } from './db.js';

const env = process.env;
const PORT = Number(env.PORT ?? 8080);

if (!env.DYNAMODB_TABLE || !env.JWT_SECRET) {
  console.error('DYNAMODB_TABLE and JWT_SECRET are required. See .env.example.');
  process.exit(1);
}

/**
 * Local development server. Production runs the same app through src/lambda.js.
 */
try {
  await connect(env.DYNAMODB_TABLE, env.AWS_REGION ?? 'us-east-1', { ensureIndexExists: true });
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

const app = await buildApp();

const shutdown = async () => { await app.close(); await close(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: PORT, host: '0.0.0.0' });
