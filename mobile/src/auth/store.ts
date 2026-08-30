import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';

/**
 * Account state.
 *
 * There is deliberately no sign-in gate. The app is fully usable — every
 * exercise, every program, every logged set — without an account, because
 * requiring a signup before a user can log their first set would be the single
 * biggest friction we could add. An account buys exactly one thing: the same
 * history on a second device.
 *
 * The session token lives in the platform keychain (Keychain / Keystore), never
 * in AsyncStorage, since it grants access to the user's whole history.
 */

const TOKEN_KEY = 'session_token';
const USER_KEY = 'user_id';

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  userId: string | null;
  token: string | null;
}

let state: AuthState = { status: 'loading', userId: null, token: null };
const listeners = new Set<() => void>();

function set(next: AuthState) {
  state = next;
  listeners.forEach((l) => l());
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}

export const getAuth = () => state;

/** Restores a previous session at boot. Never throws — signed out is a fine outcome. */
export async function restoreSession(): Promise<void> {
  try {
    const [token, userId] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    set(token && userId
      ? { status: 'signedIn', token, userId }
      : { status: 'signedOut', token: null, userId: null });
  } catch {
    set({ status: 'signedOut', token: null, userId: null });
  }
}

export async function saveSession(token: string, userId: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token),
    SecureStore.setItemAsync(USER_KEY, userId),
  ]);
  set({ status: 'signedIn', token, userId });
}

/**
 * Signs out without touching a single row of local data.
 *
 * This is the important half: the user's workouts are theirs and live on their
 * phone. Signing out stops syncing; it does not delete a training history.
 */
export async function signOut(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(USER_KEY).catch(() => {}),
  ]);
  set({ status: 'signedOut', token: null, userId: null });
}
