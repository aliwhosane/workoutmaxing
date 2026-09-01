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
 * The real columns of a local table, read from SQLite itself.
 *
 * The alternative — a hand-written list — is a second copy of the schema that
 * drifts the first time a migration adds a column, and drifts silently, since
 * the symptom is one field quietly not syncing. `PRAGMA table_info` cannot
 * drift: it is the schema. Cached because it only changes at migration time,
 * which happens once, before any of this runs.
 *
 * Table names are interpolated, not bound, because a pragma cannot take a
 * parameter — safe here because they come from the SYNCED_TABLES constant and
 * never from data.
 */
const columnCache = new Map<SyncedTable, Set<string>>();

async function columnsOf(
  db: Awaited<ReturnType<typeof getDb>>,
  table: SyncedTable,
): Promise<Set<string>> {
  const cached = columnCache.get(table);
  if (cached) return cached;

  const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  const columns = new Set(info.map((c) => c.name));
  columnCache.set(table, columns);
  return columns;
}

/** What SQLite can be handed as a bound parameter. */
const isScalar = (v: unknown): v is string | number | boolean | null =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/**
 * Writes a server row locally, but never over a newer local edit — a row the
 * user has changed since their last successful push wins until it has been
 * pushed itself. Incoming rows arrive clean, since by definition the server
 * already has them.
 *
 * The column names in the response decide the shape of this INSERT, and a
 * column name cannot be a bound parameter — it is concatenated into the SQL.
 * So they are checked against the table's real columns first, and anything
 * else is dropped.
 *
 * Without that, part of this statement is written by whatever answered the
 * request. Any JSON key is a legal attribute name, so a response could put
 * arbitrary text into the identifier list. `prepareAsync` compiles one
 * statement, so a trailing `; DROP TABLE ...` does not run — but the reliable
 * damage needs nothing so exotic: the statement fails to compile, that throws
 * inside the transaction, the whole sync fails, and because the row comes back
 * on the next pull it fails again every time. One row ends sync permanently.
 *
 * The server rejects such names on the way in too. This check stays regardless:
 * the phone owns this data, the server is just the network, and the network
 * does not get to be the only thing standing between the two.
 *
 * Dropping unknown columns also makes the older, duller failure impossible: a
 * row from a newer app version carrying a column this one has never heard of
 * used to throw mid-transaction, failing the whole sync and every sync after
 * it, since the row came back on the next pull to fail again.
 */
async function upsert(
  db: Awaited<ReturnType<typeof getDb>>,
  table: SyncedTable,
  row: Row,
): Promise<void> {
  const pk = PRIMARY_KEY[table];
  const columns = await columnsOf(db, table);

  const key = row[pk];
  if (typeof key !== 'string' || key.length === 0) return;

  // `dirty` is set here and taken out of the row, because an incoming row is
  // by definition already on the server.
  //
  // It used to be appended *alongside* the row's own `dirty`, naming the column
  // twice in one INSERT. SQLite allows that and keeps the first value, which
  // was the server's 1 rather than the intended 0 — so every pulled row landed
  // marked as having unpushed changes, and went straight back up on the next
  // sync. Since a pull returns the rows the same request just pushed, that
  // looped: the whole history re-uploaded itself on every sync, forever, and
  // grew with the history.
  const cols = Object.keys(row).filter(
    (c) => c !== 'dirty' && columns.has(c) && isScalar(row[c]),
  );
  if (!cols.includes(pk)) return;

  // The merge clock has to be a real number or last-write-wins compares
  // against NaN, which is false either way and would let a stale row through.
  const stamp = Number.isFinite(row.updated_at) ? row.updated_at : 0;

  const local = await db.getFirstAsync<{ updated_at: number; dirty: number }>(
    `SELECT updated_at, dirty FROM ${table} WHERE ${pk} = ?`, key,
  );
  if (local && local.dirty === 1 && local.updated_at > stamp) return;

  const names = [...cols, 'dirty'];
  const values = [...cols.map((c) => (c === 'updated_at' ? stamp : row[c])), 0];
  const assignments = names.filter((c) => c !== pk).map((c) => `${c} = excluded.${c}`);

  await db.runAsync(
    `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})
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
