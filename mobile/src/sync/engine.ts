import { getDb, kvGet, kvSet } from '../db/client';
import { SYNCED_TABLES, PRIMARY_KEY, type SyncedTable } from '../db/schema';

/**
 * Delta sync client.
 *
 * The phone is the source of truth and the app is fully usable with the server
 * unreachable — sync is a background convenience that lets a second device
 * catch up, not something any screen waits on.
 *
 * One request does both directions: push everything marked dirty, receive
 * everything changed elsewhere since our cursor.
 */

const CURSOR_KEY = 'sync_cursor';
const BATCH = 500;

/**
 * How long to wait on the server before giving up.
 *
 * Without this a request to a host that silently drops packets — a captive
 * portal, a VPN half-connected, a server that has moved — hangs for as long as
 * the OS is willing to wait, which can be minutes. That would be survivable if
 * it only delayed one sync, but `syncNow` holds an in-flight guard for the
 * duration, so a single hung request blocks every later sync for the life of
 * the app. Failing in fifteen seconds and retrying is strictly better.
 */
const REQUEST_TIMEOUT_MS = 15_000;

export interface SyncResult {
  pushed: number;
  pulled: number;
  hasMore: boolean;
}

type Row = Record<string, unknown> & { updated_at: number };

export async function sync(baseUrl: string, token: string): Promise<SyncResult> {
  const db = await getDb();
  const since = await kvGet(CURSOR_KEY);

  /**
   * Collect dirty rows, remembering each row's updated_at as we read it.
   * That stamp is the guard for clearing the dirty flag later: if the user
   * edits a row while the request is in flight, its updated_at moves and the
   * row correctly stays dirty rather than having its edit silently dropped.
   */
  const changes: Partial<Record<SyncedTable, Row[]>> = {};
  const sent: { table: SyncedTable; id: string; stamp: number }[] = [];

  for (const table of SYNCED_TABLES) {
    const rows = await db.getAllAsync<Row>(
      `SELECT * FROM ${table} WHERE dirty = 1 LIMIT ${BATCH}`,
    );
    if (rows.length === 0) continue;
    changes[table] = rows;
    const pk = PRIMARY_KEY[table];
    for (const r of rows) sent.push({ table, id: String(r[pk]), stamp: r.updated_at });
  }

  const response = await fetch(`${baseUrl}/sync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ since, changes }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`sync failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as {
    cursor: string;
    changes: Partial<Record<SyncedTable, Row[]>>;
    hasMore: boolean;
  };

  let pulled = 0;

  await db.withTransactionAsync(async () => {
    // Apply what the server sent, oldest table first so foreign keys resolve.
    for (const table of SYNCED_TABLES) {
      for (const row of body.changes[table] ?? []) {
        pulled++;
        await upsert(db, table, row);
      }
    }

    // Clear dirty only where the row is untouched since we read it.
    for (const s of sent) {
      await db.runAsync(
        `UPDATE ${s.table} SET dirty = 0 WHERE ${PRIMARY_KEY[s.table]} = ? AND updated_at = ?`,
        s.id, s.stamp,
      );
    }

    await kvSet(CURSOR_KEY, body.cursor);
  });

  return { pushed: sent.length, pulled, hasMore: body.hasMore };
}

/**
 * Writes a server row locally, but never over a newer local edit — a row the
 * user has changed since their last successful push wins until it has been
 * pushed itself. Incoming rows arrive clean, since by definition the server
 * already has them.
 */
async function upsert(
  db: Awaited<ReturnType<typeof getDb>>,
  table: SyncedTable,
  row: Row,
): Promise<void> {
  const pk = PRIMARY_KEY[table];
  const key = row[pk];

  const local = await db.getFirstAsync<{ updated_at: number; dirty: number }>(
    `SELECT updated_at, dirty FROM ${table} WHERE ${pk} = ?`, key as any,
  );
  if (local && local.dirty === 1 && local.updated_at > row.updated_at) return;

  const cols = [...Object.keys(row), 'dirty'];
  const values = [...Object.values(row), 0];
  const assignments = cols.filter((c) => c !== pk).map((c) => `${c} = excluded.${c}`);

  await db.runAsync(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
     ON CONFLICT(${pk}) DO UPDATE SET ${assignments.join(', ')}`,
    ...(values as any[]),
  );
}

/** True when anything is waiting to go up — drives the "unsynced" indicator. */
export async function hasPendingChanges(): Promise<boolean> {
  const db = await getDb();
  for (const table of SYNCED_TABLES) {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE dirty = 1`,
    );
    if ((row?.n ?? 0) > 0) return true;
  }
  return false;
}

export const resetCursor = () => kvSet(CURSOR_KEY, '');
