import { MongoClient } from 'mongodb';

/** Collections that mirror the phone's SQLite tables, in dependency order. */
export const SYNCED = [
  'program', 'program_day', 'program_slot', 'enrollment',
  'workout', 'logged_set', 'custom_exercise', 'exercise_pref', 'body_metric',
  'progression_state',
];

/**
 * The identifying field per collection, mirroring the phone's schema. Almost
 * everything carries a client-minted `id`; a user has exactly one preference
 * row per exercise, so that one is keyed by the exercise.
 */
export const PRIMARY_KEY = {
  program: 'id', program_day: 'id', program_slot: 'id', enrollment: 'id',
  workout: 'id', logged_set: 'id', custom_exercise: 'id',
  exercise_pref: 'exercise_id', body_metric: 'id', progression_state: 'id',
};

let client;
let database;

export async function connect(uri, dbName) {
  client = new MongoClient(uri, {
    // A phone on a train opens and drops connections constantly; fail fast
    // rather than holding a request open while the client has already given up.
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 20,
  });
  await client.connect();
  database = client.db(dbName);
  await ensureIndexes();
  return database;
}

export const db = () => database;
export const close = () => client?.close();

/**
 * A delta pull is "everything of mine changed since cursor X, in order".
 * The compound index on (userId, updatedAt) turns that into one range scan,
 * so pull cost tracks how much changed rather than how much history exists.
 *
 * The unique index on (userId, id) is what makes push idempotent: a client
 * that retries after a dropped response upserts the same row instead of
 * duplicating it.
 */
async function ensureIndexes() {
  for (const name of SYNCED) {
    const c = database.collection(name);
    await c.createIndex({ userId: 1, updatedAt: 1 });
    await c.createIndex({ userId: 1, [PRIMARY_KEY[name]]: 1 }, { unique: true });
  }
  await database.collection('users').createIndex({ subject: 1 }, { unique: true });
  await database.collection('devices').createIndex({ userId: 1, deviceId: 1 }, { unique: true });
}
