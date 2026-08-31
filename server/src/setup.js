import { connect, close, GSI } from './db.js';

/**
 * One-time table preparation: creates the delta-sync index if it is missing.
 *
 * Separate from the server so the running application needs no permission to
 * alter the table, and so a cold start never pays for the check.
 */
const table = process.env.DYNAMODB_TABLE;
const region = process.env.AWS_REGION ?? 'us-east-1';

if (!table) {
  console.error('DYNAMODB_TABLE is required.');
  process.exit(1);
}

console.log(`preparing ${table} in ${region}`);
await connect(table, region, { ensureIndexExists: true });
console.log(`index ${GSI} is present. It may take a few minutes to finish backfilling.`);
await close();
