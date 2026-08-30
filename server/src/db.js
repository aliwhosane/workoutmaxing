import { DynamoDBClient, DescribeTableCommand, UpdateTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * DynamoDB, single table.
 *
 * The table's partition key is a string named `twenty_one`, which is what it
 * was created with and cannot be changed after the fact. That is fine — we
 * simply put a composite key in it:
 *
 *     <userId>#<table>#<rowId>
 *
 * That gives every row a unique address, so a push is a plain PutItem and a
 * client retrying after a dropped response overwrites rather than duplicates.
 * It replaces Mongo's unique (userId, id) index exactly.
 */

/** Logical tables, mirroring the phone's SQLite schema. */
export const SYNCED = [
  'program', 'program_day', 'program_slot', 'enrollment',
  'workout', 'logged_set', 'custom_exercise', 'exercise_pref', 'body_metric',
  'progression_state',
];

export const PRIMARY_KEY = {
  program: 'id', program_day: 'id', program_slot: 'id', enrollment: 'id',
  workout: 'id', logged_set: 'id', custom_exercise: 'id',
  exercise_pref: 'exercise_id', body_metric: 'id', progression_state: 'id',
};

/** The table's own partition key attribute name. */
export const PK = 'twenty_one';

/**
 * The index the whole sync protocol rests on.
 *
 * A delta pull is "everything of mine changed since cursor X, in order".
 * Against the base table that would be a full Scan filtered down — billed per
 * item examined, and growing with total history rather than with what changed.
 * This GSI turns it into a single Query whose cost tracks the number of
 * changed rows, which is the only shape that stays affordable.
 */
export const GSI = 'by_user_updated';

let client;
let doc;
let tableName;

export async function connect(table, region) {
  tableName = table;
  client = new DynamoDBClient({ region });
  doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
  });
  await ensureIndex();
  return doc;
}

export const db = () => doc;
export const table = () => tableName;
export const close = () => client?.destroy();

/** Composite address for a row. */
export const rowKey = (userId, logicalTable, id) => `${userId}#${logicalTable}#${id}`;

/**
 * Creates the delta-sync index if it is missing.
 *
 * Adding a GSI to a live table is an online operation, so this is safe to run
 * at boot. It is not instant, though — the table reports ACTIVE while the index
 * backfills, and Queries against it fail until it is ready, so we surface the
 * state rather than pretending sync is available.
 */
async function ensureIndex() {
  const described = await client.send(new DescribeTableCommand({ TableName: tableName }));
  const existing = described.Table.GlobalSecondaryIndexes ?? [];
  const found = existing.find((i) => i.IndexName === GSI);

  if (found) {
    if (found.IndexStatus !== 'ACTIVE') {
      console.warn(`[db] index ${GSI} is ${found.IndexStatus}; pulls will fail until it is ACTIVE`);
    }
    return;
  }

  console.warn(`[db] creating index ${GSI} — this backfills in the background`);
  await client.send(new UpdateTableCommand({
    TableName: tableName,
    AttributeDefinitions: [
      { AttributeName: PK, AttributeType: 'S' },
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'updatedAt', AttributeType: 'N' },
    ],
    GlobalSecondaryIndexUpdates: [{
      Create: {
        IndexName: GSI,
        KeySchema: [
          { AttributeName: 'userId', KeyType: 'HASH' },
          { AttributeName: 'updatedAt', KeyType: 'RANGE' },
        ],
        // The client needs whole rows back, and fetching them individually
        // after the Query would cost one read each.
        Projection: { ProjectionType: 'ALL' },
      },
    }],
  }));
}
