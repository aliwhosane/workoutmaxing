import { QueryCommand, BatchWriteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { db, table, SYNCED, PRIMARY_KEY, PK, GSI, rowKey } from './db.js';

/**
 * Delta sync.
 *
 * One round trip does both directions: the client sends everything it has
 * changed since it last succeeded, and receives everything anyone else changed
 * in the same window.
 *
 * Conflicts resolve last-write-wins on `updatedAt`, per row. That is the right
 * trade here because of what the data is: sets are append-only in practice and
 * carry client-minted UUIDs, so two phones almost never touch the same row. The
 * case it does cover — editing the same program on two devices — is one where
 * "most recent edit wins" is also what a person would expect.
 *
 * The cursor is a server timestamp, never a client one. Phone clocks are wrong
 * often enough that trusting them would silently drop rows from a pull.
 */

const MAX_ROWS_PER_PULL = 2000;
/** DynamoDB's hard limit for BatchWriteItem. */
const BATCH_LIMIT = 25;

/* ---------------------------------------------------------- validation */

/**
 * What a pushed row is allowed to be.
 *
 * Everything in this table is a flat row of SQLite scalars — there is no
 * nested data anywhere in the schema — so that is exactly what is accepted.
 * Anything else is rejected rather than stored.
 *
 * This is not only about what DynamoDB will hold. Whatever is stored here is
 * handed straight back to every one of that account's devices on their next
 * pull, and the client builds its local INSERT from the *column names* in the
 * response. So an attribute name is not inert data: it reaches the phone as
 * SQL. The client whitelists them against its own schema as well, but a server
 * that will store `name); DROP TABLE workout; --` as a column is one bad
 * client version away from shipping it, and there is no reason to store it.
 */
const MAX_ROWS_PER_TABLE = 1000;
const MAX_ATTRIBUTES_PER_ROW = 64;
const MAX_ID_LENGTH = 128;
const MAX_STRING_LENGTH = 65_536;
/**
 * DynamoDB refuses any item over 400 KB, and it refuses the *batch* it arrived
 * in, so one oversized row would stop twenty-four good ones from being written.
 * Caught here, where the response can say which row and why.
 */
const MAX_ROW_BYTES = 300_000;

/** Column names, matching the shape SQLite identifiers actually take here. */
const ATTRIBUTE_RE = /^[a-z][a-z0-9_]{0,62}$/;

/** Client-minted UUIDv7 today, but kept broad enough not to break on a future id scheme. */
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Attributes the server owns. A row carrying one of these is refused rather
 * than silently overwritten: `userId` and `updatedAt` are the sync index's key
 * attributes and `twenty_one` is the table's partition key, so a client that
 * believes it can set them is confused about something that matters.
 */
const RESERVED = new Set([PK, 'userId', 'table', 'updatedAt', 'clientUpdatedAt']);

function reject(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Checks one row and returns the attributes worth storing.
 *
 * `updated_at` is pulled out by the caller; everything else has to survive
 * this to be written.
 */
function validateRow(logical, row, pk) {
  if (!isPlainObject(row)) throw reject(`${logical}: each row must be an object`);

  const id = row[pk];
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw reject(`${logical}: ${pk} must be a string of at most ${MAX_ID_LENGTH} id characters`);
  }

  const keys = Object.keys(row);
  if (keys.length > MAX_ATTRIBUTES_PER_ROW) {
    throw reject(`${logical}: a row may not carry more than ${MAX_ATTRIBUTES_PER_ROW} fields`);
  }

  const clean = {};
  for (const key of keys) {
    if (key === 'updated_at') continue;
    if (RESERVED.has(key)) throw reject(`${logical}: "${key}" is set by the server`);
    if (!ATTRIBUTE_RE.test(key)) throw reject(`${logical}: "${key}" is not a valid field name`);

    const value = row[key];
    if (value === null || value === undefined) {
      clean[key] = null;
    } else if (typeof value === 'string') {
      if (value.length > MAX_STRING_LENGTH) {
        throw reject(`${logical}.${key}: longer than ${MAX_STRING_LENGTH} characters`);
      }
      clean[key] = value;
    } else if (typeof value === 'number') {
      // NaN and Infinity have no DynamoDB representation and fail the whole
      // batch on marshalling, taking every other row in it with them.
      if (!Number.isFinite(value)) throw reject(`${logical}.${key}: must be a finite number`);
      clean[key] = value;
    } else if (typeof value === 'boolean') {
      clean[key] = value;
    } else {
      throw reject(`${logical}.${key}: must be a string, number, boolean or null`);
    }
  }

  const bytes = Buffer.byteLength(JSON.stringify(clean));
  if (bytes > MAX_ROW_BYTES) {
    throw reject(`${logical}: row ${id} is ${bytes} bytes, over the ${MAX_ROW_BYTES} byte limit`);
  }

  return { id, clean };
}

/** The client's own clock, kept for display but never trusted as a cursor. */
function clientStamp(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/* ---------------------------------------------------------------- push */

export async function push(userId, changes) {
  const applied = {};
  const now = Date.now();

  if (changes !== undefined && changes !== null && !isPlainObject(changes)) {
    throw reject('changes must be an object');
  }

  for (const logical of SYNCED) {
    const rows = changes?.[logical];
    if (rows === undefined || rows === null) continue;
    if (!Array.isArray(rows)) throw reject(`${logical}: changes must be an array`);
    if (rows.length === 0) continue;
    if (rows.length > MAX_ROWS_PER_TABLE) {
      throw reject(`${logical}: ${rows.length} rows exceeds the ${MAX_ROWS_PER_TABLE} per request limit`);
    }

    const pk = PRIMARY_KEY[logical];
    const items = rows.map((row) => {
      const { id, clean } = validateRow(logical, row, pk);
      return {
        PutRequest: {
          Item: {
            ...clean,
            [PK]: rowKey(userId, logical, id),
            userId,
            table: logical,
            clientUpdatedAt: clientStamp(row.updated_at),
            // Server time is authoritative so cursors stay monotonic even
            // when a device's own clock is skewed.
            updatedAt: now,
          },
        },
      };
    });

    for (let i = 0; i < items.length; i += BATCH_LIMIT) {
      await writeBatch(items.slice(i, i + BATCH_LIMIT));
    }
    applied[logical] = items.length;
  }

  return applied;
}

/**
 * BatchWriteItem can succeed partially, returning whatever it declined to
 * write. Those are not errors — they are throttling — so they are retried with
 * backoff rather than surfaced. Dropping them would silently lose a set.
 */
async function writeBatch(requests) {
  let pending = requests;
  for (let attempt = 0; attempt < 6 && pending.length > 0; attempt++) {
    const result = await db().send(new BatchWriteCommand({
      RequestItems: { [table()]: pending },
    }));
    pending = result.UnprocessedItems?.[table()] ?? [];
    if (pending.length > 0) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 50));
    }
  }
  if (pending.length > 0) {
    throw new Error(`${pending.length} items could not be written after retries`);
  }
}

/* ---------------------------------------------------------------- pull */

/**
 * The cursor as the client sent it back.
 *
 * It is a server timestamp we issued, but it arrives over the wire, so it is
 * re-checked rather than coerced: `Number("whatever")` is NaN, which has no
 * DynamoDB representation and fails the Query on marshalling. A cursor that
 * makes no sense simply starts from the beginning, which is correct — a full
 * pull is never wrong, only slower.
 */
function parseCursor(since) {
  if (since === undefined || since === null || since === '') return 0;
  const n = Number(since);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export async function pull(userId, since) {
  const after = parseCursor(since);
  const changes = {};
  for (const logical of SYNCED) changes[logical] = [];

  let high = after;
  let count = 0;
  let cursorKey;
  let truncated = false;

  /**
   * One Query serves every logical table at once: the index is ordered by
   * updatedAt across the whole user, which is exactly the order a delta needs.
   * Rows are sorted into their tables on the way out.
   */
  do {
    const page = await db().send(new QueryCommand({
      TableName: table(),
      IndexName: GSI,
      KeyConditionExpression: 'userId = :u AND updatedAt > :t',
      ExpressionAttributeValues: { ':u': userId, ':t': after },
      Limit: Math.min(MAX_ROWS_PER_PULL - count, 500),
      ExclusiveStartKey: cursorKey,
    }));

    for (const item of page.Items ?? []) {
      const { [PK]: _pk, userId: _u, table: logical, clientUpdatedAt, updatedAt, ...rest } = item;
      // `Object.hasOwn`, not truthiness: a logical name like "constructor"
      // would otherwise find something on the prototype and push onto it.
      if (!Object.hasOwn(changes, logical)) continue; // a table this server version doesn't know
      changes[logical].push({ ...rest, updated_at: clientUpdatedAt ?? updatedAt });
      if (updatedAt > high) high = updatedAt;
      count++;
    }

    cursorKey = page.LastEvaluatedKey;
    if (count >= MAX_ROWS_PER_PULL && cursorKey) truncated = true;
  } while (cursorKey && count < MAX_ROWS_PER_PULL);

  return {
    // Advance only to the newest row actually returned. If the page was capped,
    // the client comes straight back for the next slice instead of skipping it.
    cursor: String(high),
    changes,
    hasMore: truncated,
  };
}

/* ------------------------------------------------------------- deletion */

/**
 * Erases everything the server holds for one account.
 *
 * Apple requires any app offering sign-in to offer deletion from inside the
 * app, and it is the right behaviour regardless: an account someone can create
 * in two taps should not take an email and a week to remove.
 *
 * Three sets of items have to go, found three different ways:
 *
 *   1. synced rows — a Query on the sync index, which is what it is for
 *   2. device records — enumerated from the set kept on the account, because
 *      they carry no `updatedAt` and so are absent from that index
 *   3. the account row itself, whose key we already know
 *
 * Deliberately not a Scan. Deletion is rare, but "rare" is not a reason to make
 * it cost proportional to every other user's data.
 */
export async function deleteAccount(userId) {
  const deleted = { rows: 0, devices: 0, account: 0 };
  const keys = [];

  // 1. everything the user has synced
  let cursorKey;
  do {
    const page = await db().send(new QueryCommand({
      TableName: table(),
      IndexName: GSI,
      KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': userId },
      ProjectionExpression: PK,
      ExclusiveStartKey: cursorKey,
    }));
    for (const item of page.Items ?? []) keys.push(item[PK]);
    cursorKey = page.LastEvaluatedKey;
  } while (cursorKey);
  deleted.rows = keys.length;

  // 2. devices, from the set kept on the account
  const account = await db().send(new GetCommand({
    TableName: table(),
    Key: { [PK]: `user#${userId}` },
  }));
  for (const deviceId of account.Item?.deviceIds ?? []) {
    keys.push(`device#${userId}#${deviceId}`);
    deleted.devices++;
  }

  // 3. the account row last, so a failure part-way through leaves something
  //    still pointing at the leftovers rather than orphaning them.
  if (account.Item) {
    keys.push(`user#${userId}`);
    deleted.account = 1;
  }

  for (let i = 0; i < keys.length; i += BATCH_LIMIT) {
    await writeBatch(
      keys.slice(i, i + BATCH_LIMIT).map((k) => ({ DeleteRequest: { Key: { [PK]: k } } })),
    );
  }

  return deleted;
}
