import { getDb } from '../db/client';
import { SYNCED_TABLES } from '../db/schema';
import { getAuth, signOut } from './store';
import { apiBaseUrl } from './signIn';

const TIMEOUT_MS = 20_000;

/**
 * Deletes the account and everything the server holds for it.
 *
 * Local history is deliberately kept. The server copy exists only so a second
 * device can catch up — deleting the account is a decision about *syncing*, not
 * a decision to throw away someone's training log. Anyone who does want the
 * local data gone can delete the app, and the confirmation says so.
 *
 * Afterwards every local row is marked dirty again and the sync cursor is
 * cleared. Without that, signing in later would leave the phone believing its
 * rows were already uploaded, and a history the user still has on screen would
 * never reach their next device.
 */
export async function deleteAccount(): Promise<void> {
  const auth = getAuth();
  if (auth.status !== 'signedIn' || !auth.token) return;

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/account`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${auth.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error(
      "Couldn't reach the sync server, so nothing was deleted. Try again when you have a connection.",
    );
  }

  if (!response.ok) {
    throw new Error(`The server refused the request (${response.status}).`);
  }

  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const table of SYNCED_TABLES) {
      await db.runAsync(`UPDATE ${table} SET dirty = 1`);
    }
    await db.runAsync("DELETE FROM kv WHERE key = 'sync_cursor'");
  });

  await signOut();
}
