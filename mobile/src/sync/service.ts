import { useSyncExternalStore } from 'react';
import { getAuth } from '../auth/store';
import { apiBaseUrl } from '../auth/signIn';
import { sync, hasPendingChanges } from './engine';

/**
 * Sync orchestration.
 *
 * Sync is always a background activity. No screen awaits it, no spinner blocks
 * on it, and a failure is not an error the user has to acknowledge — the phone
 * already has their data, and the next attempt will carry it up.
 */

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  pending: boolean;
  error: string | null;
}

let state: SyncState = { status: 'idle', lastSyncedAt: null, pending: false, error: null };
const listeners = new Set<() => void>();

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}

/** Guards against two syncs overlapping and pushing the same rows twice. */
let inFlight: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (inFlight) return inFlight;

  const auth = getAuth();
  if (auth.status !== 'signedIn' || !auth.token) {
    // Not signed in is a normal state, not a failure worth surfacing.
    return Promise.resolve();
  }

  inFlight = (async () => {
    set({ status: 'syncing', error: null });
    try {
      let result = await sync(apiBaseUrl(), auth.token!);

      // A capped page means the server had more than one batch for us; keep
      // going rather than leaving the device silently behind.
      let guard = 0;
      while (result.hasMore && guard++ < 20) {
        result = await sync(apiBaseUrl(), auth.token!);
      }

      set({
        status: 'idle',
        lastSyncedAt: Date.now(),
        pending: await hasPendingChanges(),
        error: null,
      });
    } catch (err) {
      // Almost always a dropped connection. The data is safe locally; try later.
      set({ status: 'error', error: (err as Error).message, pending: true });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Fire-and-forget trigger for the places sync should happen automatically. */
export const syncInBackground = () => { void syncNow(); };

export async function refreshPendingFlag(): Promise<void> {
  set({ pending: await hasPendingChanges() });
}
