import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';

/**
 * The single in-flight open. Caching the *promise* rather than the resolved
 * handle means concurrent callers during boot share one open and one migration
 * pass instead of racing each other.
 */
let _opening: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * The database, opening it on first use.
 *
 * Every query goes through here rather than a handle that has to be initialised
 * first, so there is no order in which the app can start that produces a
 * "database not open" error — including a Fast Refresh that resets module state
 * without remounting the component that did the opening.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_opening) _opening = openInternal();
  return _opening;
}

/** Explicit boot-time open, so migrations finish before the first screen paints. */
export const openDatabase = getDb;

/**
 * Uses SQLite's own `user_version` pragma as the migration pointer rather than
 * a table we'd have to maintain — it is atomic with the transaction that
 * applies the migration, so a crash mid-upgrade can never leave a half-migrated
 * database claiming to be current.
 */
async function openInternal(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('workoutmaxing.db');

  // Connection pragmas, set before any transaction opens: SQLite refuses to
  // change journal mode from inside one. WAL lets a read (rendering history)
  // proceed while a write (logging a set) is in flight, which is exactly the
  // access pattern of the workout screen.
  await db.execAsync('PRAGMA journal_mode = WAL');
  await db.execAsync('PRAGMA foreign_keys = ON');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (let v = current; v < SCHEMA_VERSION; v++) {
    await db.withTransactionAsync(async () => {
      for (const stmt of MIGRATIONS[v]) await db.execAsync(stmt);
      await db.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }

  return db;
}

/**
 * UUIDv7 — time-ordered, so rows created on two offline devices interleave
 * correctly by creation time once they meet, and index locality stays good.
 * Layout: 48 bits ms timestamp | 4 bits version | 74 bits randomness.
 *
 * Hermes has no global `crypto`, so randomness comes from expo-crypto rather
 * than the Web Crypto API this would use on the web.
 */
export function uuid(): string {
  const ms = Date.now();
  const b = Crypto.getRandomBytes(16);

  b[0] = (ms / 2 ** 40) & 0xff;
  b[1] = (ms / 2 ** 32) & 0xff;
  b[2] = (ms / 2 ** 24) & 0xff;
  b[3] = (ms / 2 ** 16) & 0xff;
  b[4] = (ms / 2 ** 8) & 0xff;
  b[5] = ms & 0xff;
  b[6] = 0x70 | (b[6] & 0x0f); // version 7
  b[8] = 0x80 | (b[8] & 0x3f); // RFC 4122 variant

  let h = '';
  for (let i = 0; i < 16; i++) h += b[i].toString(16).padStart(2, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Small helpers so no call site ever forgets to stamp the sync clock. */
export const now = () => Date.now();

export async function kvGet(key: string): Promise<string | null> {
  const r = await (await getDb()).getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return r?.value ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  await (await getDb()).runAsync(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, value,
  );
}
