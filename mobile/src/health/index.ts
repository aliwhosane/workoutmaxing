import { Platform } from 'react-native';
import { UNAVAILABLE, type HealthBridge, type WorkoutSummary } from './types';

export * from './types';

/**
 * The platform's health store, or a no-op stand-in.
 *
 * Callers never branch on platform. They call `health.saveWorkout(...)` and
 * either it lands in Apple Health / Health Connect or it quietly doesn't —
 * writing to the health store is a nicety layered on top of the app's own
 * database, never a step the user's data depends on.
 */

let bridge: HealthBridge | undefined;

/**
 * Resolved on first call, not while this module is being evaluated.
 *
 * Picking the bridge eagerly meant `require`ing the HealthKit or Health
 * Connect native module during the import graph — so every launch paid for it,
 * including the launches of everyone who never turns health sync on. It also
 * broke the rule that no native module is touched at module load time: the
 * try/catch inside each bridge kept that from crashing the app, but the boot
 * path is not the place to find out.
 */
function platform(): HealthBridge {
  if (bridge) return bridge;
  bridge =
    Platform.OS === 'ios'
      ? (require('./appleHealth').appleHealthOrUnavailable() as HealthBridge)
      : Platform.OS === 'android'
        ? (require('./healthConnect').healthConnectOrUnavailable() as HealthBridge)
        : UNAVAILABLE;
  return bridge;
}

export const health: HealthBridge = {
  isAvailable: () => platform().isAvailable(),
  getPermissionState: () => platform().getPermissionState(),
  requestPermissions: () => platform().requestPermissions(),
  saveWorkout: (summary: WorkoutSummary) => platform().saveWorkout(summary),
  readLatestBodyweightKg: () => platform().readLatestBodyweightKg(),
  writeBodyweightKg: (kg: number, at?: Date) => platform().writeBodyweightKg(kg, at),
};

/** Human label for the platform's health store, for use in settings copy. */
export const healthStoreName =
  Platform.OS === 'ios' ? 'Apple Health'
  : Platform.OS === 'android' ? 'Health Connect'
  : 'Health';
