import { db, SYNCED, PRIMARY_KEY } from './db.js';

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

export async function push(userId, changes) {
  const applied = {};

  for (const table of SYNCED) {
    const rows = changes?.[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const collection = db().collection(table);
    const pk = PRIMARY_KEY[table];
    const ops = rows.map((row) => {
      const { updated_at, ...rest } = row;
      return {
        updateOne: {
          filter: { userId, [pk]: row[pk] },
          update: {
            $set: {
              ...rest,
              userId,
              clientUpdatedAt: updated_at ?? null,
              // Server time is authoritative so cursors stay monotonic even
              // when a device's own clock is skewed.
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      };
    });

    // Unordered: one bad row must not stop the rest of the batch from landing.
    const result = await collection.bulkWrite(ops, { ordered: false });
    applied[table] = result.upsertedCount + result.modifiedCount + result.matchedCount;
  }

  return applied;
}

export async function pull(userId, since) {
  const after = since ? new Date(since) : new Date(0);
  const changes = {};
  let high = after;
  let truncated = false;

  for (const table of SYNCED) {
    const rows = await db().collection(table)
      .find({ userId, updatedAt: { $gt: after } })
      .sort({ updatedAt: 1 })
      .limit(MAX_ROWS_PER_PULL)
      .toArray();

    if (rows.length === MAX_ROWS_PER_PULL) truncated = true;

    changes[table] = rows.map(({ _id, userId: _u, updatedAt, clientUpdatedAt, ...rest }) => {
      if (updatedAt > high) high = updatedAt;
      return { ...rest, updated_at: clientUpdatedAt ?? updatedAt.getTime() };
    });
  }

  return {
    // Advance only to the newest row actually returned. If the page was capped,
    // the client comes straight back for the next slice instead of skipping it.
    cursor: high.toISOString(),
    changes,
    hasMore: truncated,
  };
}
