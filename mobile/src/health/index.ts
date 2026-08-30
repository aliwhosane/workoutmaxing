import { Platform } from 'react-native';
import { UNAVAILABLE, type HealthBridge } from './types';

export * from './types';

/**
 * The platform's health store, or a no-op stand-in.
 *
 * Callers never branch on platform. They call `health.saveWorkout(...)` and
 * either it lands in Apple Health / Health Connect or it quietly doesn't —
 * writing to the health store is a nicety layered on top of the app's own
 * database, never a step the user's data depends on.
 */
export const health: HealthBridge = (() => {
  if (Platform.OS === 'ios') {
    return require('./appleHealth').appleHealthOrUnavailable() as HealthBridge;
  }
  if (Platform.OS === 'android') {
    return require('./healthConnect').healthConnectOrUnavailable() as HealthBridge;
  }
  return UNAVAILABLE;
})();

/** Human label for the platform's health store, for use in settings copy. */
export const healthStoreName =
  Platform.OS === 'ios' ? 'Apple Health'
  : Platform.OS === 'android' ? 'Health Connect'
  : 'Health';
