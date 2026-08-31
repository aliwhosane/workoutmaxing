import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import { saveSession } from './store';

/**
 * Sign-in providers.
 *
 * Apple on iOS, Google on Android — the two identities the platforms already
 * hold, so the user never types a password and we never store one. Both hand
 * back a signed ID token which the server verifies against the provider's
 * public keys before minting our own session.
 *
 * Google's module is required lazily because it is not present in Expo Go; a
 * top-level import would break the whole app there rather than one button.
 */

export const apiBaseUrl = (): string =>
  (Constants.expoConfig?.extra?.apiBaseUrl as string) ?? 'http://localhost:8080';

const googleWebClientId = () =>
  (Constants.expoConfig?.extra?.googleWebClientId as string | null) ?? null;
const googleIosClientId = () =>
  (Constants.expoConfig?.extra?.googleIosClientId as string | null) ?? null;

function loadGoogle() {
  try {
    return require('@react-native-google-signin/google-signin');
  } catch {
    return null;
  }
}

export async function isAppleAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export const isGoogleAvailable = (): boolean =>
  !!loadGoogle() && !!googleWebClientId();

/**
 * Trades a provider ID token for our session token and stores it.
 *
 * Bounded, because this one is in front of a person: the user has just tapped a
 * button and is watching. An unreachable server has to become a message they
 * can act on, not a spinner that never resolves.
 */
const SIGN_IN_TIMEOUT_MS = 15_000;

async function exchange(provider: 'apple' | 'google', idToken: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider,
        idToken,
        deviceId: Constants.sessionId,
        platform: Platform.OS,
      }),
      signal: AbortSignal.timeout(SIGN_IN_TIMEOUT_MS),
    });
  } catch {
    // Google and Apple already verified who they are; only our own server is
    // unreachable, and saying so is more useful than a network stack message.
    throw new Error(
      "Couldn't reach the sync server. Your workouts are safe on this phone — " +
      'try signing in again later.',
    );
  }

  if (!response.ok) {
    throw new Error(`sign-in rejected by server (${response.status})`);
  }

  const { token, userId } = await response.json();
  await saveSession(token, userId);
}

export async function signInWithApple(): Promise<void> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  if (!credential.identityToken) throw new Error('Apple returned no identity token');
  await exchange('apple', credential.identityToken);
}

export async function signInWithGoogle(): Promise<void> {
  const mod = loadGoogle();
  if (!mod) throw new Error('Google sign-in is unavailable in this build');

  const webClientId = googleWebClientId();
  if (!webClientId) throw new Error('GOOGLE_WEB_CLIENT_ID is not configured');

  mod.GoogleSignin.configure({
    webClientId,
    iosClientId: googleIosClientId() ?? undefined,
  });

  await mod.GoogleSignin.hasPlayServices();
  const result = await mod.GoogleSignin.signIn();

  // v13+ returns { type, data }; older shapes put idToken at the top level.
  const idToken = result?.data?.idToken ?? result?.idToken;
  if (!idToken) throw new Error('Google returned no identity token');

  await exchange('google', idToken);
}

/** True when the user cancelled, rather than anything actually failing. */
export function isCancellation(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? '';
  return code === 'ERR_REQUEST_CANCELED' || code === 'SIGN_IN_CANCELLED' || code === '-5';
}
