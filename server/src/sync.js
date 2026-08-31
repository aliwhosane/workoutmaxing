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

export async function push(userId, changes) {
  const applied = {};
  const now = Date.now();

  for (const logical of SYNCED) {
    const rows = changes?.[logical];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const pk = PRIMARY_KEY[logical];
    const items = rows
      .filter((row) => row?.[pk] != null)
      .map((row) => {
        const { updated_at, ...rest } = row;
        return {
          PutRequest: {
            Item: {
              ...rest,
              [PK]: rowKey(userId, logical, row[pk]),
              userId,
              table: logical,
              clientUpdatedAt: updated_at ?? null,
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

export async function pull(userId, since) {
  const after = since ? Number(since) : 0;
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
      if (!changes[logical]) continue; // a table this server version doesn't know
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
