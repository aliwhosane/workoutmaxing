import type { HealthBridge, PermissionState, WorkoutSummary } from './types';
import { UNAVAILABLE } from './types';

/**
 * Apple HealthKit.
 *
 * The native module is required lazily and behind a try/catch on purpose: it
 * does not exist in Expo Go, and a top-level import would take the whole app
 * down there rather than just disabling this one feature. Everything below
 * degrades to UNAVAILABLE instead of throwing.
 */

type HK = typeof import('@kingstinct/react-native-healthkit');

let cached: HK | null | undefined;

function load(): HK | null {
  if (cached !== undefined) return cached;
  try {
    cached = require('@kingstinct/react-native-healthkit') as HK;
  } catch {
    cached = null;
  }
  return cached;
}

const READ = ['HKQuantityTypeIdentifierBodyMass'] as const;
const SHARE = ['HKQuantityTypeIdentifierBodyMass', 'HKWorkoutTypeIdentifier'] as const;

export const appleHealth: HealthBridge = {
  async isAvailable() {
    const hk = load();
    if (!hk) return false;
    try {
      return await hk.isHealthDataAvailableAsync();
    } catch {
      return false;
    }
  },

  async getPermissionState(): Promise<PermissionState> {
    const hk = load();
    if (!hk) return 'unavailable';
    try {
      /**
       * HealthKit deliberately never reveals *read* authorisation — that would
       * leak whether the user has data they chose not to share. Only write
       * status is knowable, so that is what we report; it is also the one we
       * actually need, since saving sessions is the point.
       */
      const status = hk.authorizationStatusFor('HKWorkoutTypeIdentifier');
      // 0 = notDetermined, 1 = sharingDenied, 2 = sharingAuthorized
      if (status === 2) return 'granted';
      if (status === 1) return 'denied';
      return 'undetermined';
    } catch {
      return 'unavailable';
    }
  },

  async requestPermissions() {
    const hk = load();
    if (!hk) return false;
    try {
      await hk.requestAuthorization({ toShare: SHARE as any, toRead: READ as any });
      // requestAuthorization resolves true merely for "the sheet was shown",
      // so ask again for the status that actually matters.
      return (await appleHealth.getPermissionState()) === 'granted';
    } catch {
      return false;
    }
  },

  async saveWorkout(summary: WorkoutSummary) {
    const hk = load();
    if (!hk) return false;
    try {
      await hk.saveWorkoutSample(
        'HKWorkoutActivityTypeTraditionalStrengthTraining' as any,
        summary.activeEnergyKcal
          ? ([{
              quantityType: 'HKQuantityTypeIdentifierActiveEnergyBurned',
              unit: 'kcal',
              quantity: summary.activeEnergyKcal,
              startDate: summary.startedAt,
              endDate: summary.finishedAt,
            }] as any)
          : ([] as any),
        summary.startedAt,
        summary.finishedAt,
        undefined,
        // Our id travels with the sample so a repeat write is detectable.
        { WorkoutMaxingId: summary.id, HKWorkoutBrandName: summary.name } as any,
      );
      return true;
    } catch (err) {
      console.warn('[health] saveWorkout failed', err);
      return false;
    }
  },

  async readLatestBodyweightKg() {
    const hk = load();
    if (!hk) return null;
    try {
      const samples = await hk.queryQuantitySamples('HKQuantityTypeIdentifierBodyMass', {
        unit: 'kg',
        limit: 1,
        ascending: false,
      } as any);
      return samples[0]?.quantity ?? null;
    } catch {
      return null;
    }
  },

  async writeBodyweightKg(kg, at = new Date()) {
    const hk = load();
    if (!hk) return false;
    try {
      await hk.saveQuantitySample('HKQuantityTypeIdentifierBodyMass', 'kg' as any, kg, at, at);
      return true;
    } catch (err) {
      console.warn('[health] writeBodyweight failed', err);
      return false;
    }
  },
};

export const appleHealthOrUnavailable = (): HealthBridge =>
  load() ? appleHealth : UNAVAILABLE;
