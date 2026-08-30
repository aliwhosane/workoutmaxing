import type { HealthBridge, PermissionState, WorkoutSummary } from './types';
import { UNAVAILABLE } from './types';

/**
 * Android Health Connect.
 *
 * Same lazy-require pattern as the HealthKit bridge, for the same reason: the
 * native module is absent in Expo Go and must not take the app down with it.
 *
 * Health Connect differs from HealthKit in two ways that matter here. It is a
 * separate app that may not be installed at all (hence the SDK status check),
 * and it must be explicitly initialised before any call will succeed.
 */

type HC = typeof import('react-native-health-connect');

let cached: HC | null | undefined;
let initialised = false;

function load(): HC | null {
  if (cached !== undefined) return cached;
  try {
    cached = require('react-native-health-connect') as HC;
  } catch {
    cached = null;
  }
  return cached;
}

/** SdkAvailabilityStatus.SDK_AVAILABLE */
const SDK_AVAILABLE = 3;

const PERMISSIONS = [
  { accessType: 'write', recordType: 'ExerciseSession' },
  { accessType: 'write', recordType: 'Weight' },
  { accessType: 'read', recordType: 'Weight' },
] as const;

/** Health Connect's numeric code for strength training. */
const EXERCISE_TYPE_STRENGTH_TRAINING = 56;

async function ensureInit(hc: HC): Promise<boolean> {
  if (initialised) return true;
  try {
    if ((await hc.getSdkStatus()) !== SDK_AVAILABLE) return false;
    initialised = await hc.initialize();
    return initialised;
  } catch {
    return false;
  }
}

export const healthConnect: HealthBridge = {
  async isAvailable() {
    const hc = load();
    return hc ? ensureInit(hc) : false;
  },

  async getPermissionState(): Promise<PermissionState> {
    const hc = load();
    if (!hc || !(await ensureInit(hc))) return 'unavailable';
    try {
      const granted = await hc.getGrantedPermissions();
      const canWriteSessions = granted.some(
        (p: any) => p.recordType === 'ExerciseSession' && p.accessType === 'write',
      );
      // Health Connect cannot distinguish "never asked" from "asked and
      // refused" — both come back as simply not granted. We report
      // 'undetermined' so the UI offers the prompt again, which is harmless:
      // the system sheet is what ultimately decides.
      return canWriteSessions ? 'granted' : 'undetermined';
    } catch {
      return 'unavailable';
    }
  },

  async requestPermissions() {
    const hc = load();
    if (!hc || !(await ensureInit(hc))) return false;
    try {
      const granted = await hc.requestPermission(PERMISSIONS as any);
      return granted.some(
        (p: any) => p.recordType === 'ExerciseSession' && p.accessType === 'write',
      );
    } catch {
      return false;
    }
  },

  async saveWorkout(summary: WorkoutSummary) {
    const hc = load();
    if (!hc || !(await ensureInit(hc))) return false;
    try {
      await hc.insertRecords([
        {
          recordType: 'ExerciseSession',
          exerciseType: EXERCISE_TYPE_STRENGTH_TRAINING,
          title: summary.name,
          startTime: summary.startedAt.toISOString(),
          endTime: summary.finishedAt.toISOString(),
          metadata: { clientRecordId: summary.id },
        } as any,
      ]);
      return true;
    } catch (err) {
      console.warn('[health] saveWorkout failed', err);
      return false;
    }
  },

  async readLatestBodyweightKg() {
    const hc = load();
    if (!hc || !(await ensureInit(hc))) return null;
    try {
      const { records } = await hc.readRecords('Weight', {
        timeRangeFilter: {
          operator: 'between',
          // A year is plenty to find a current bodyweight, and bounds the read.
          startTime: new Date(Date.now() - 365 * 864e5).toISOString(),
          endTime: new Date().toISOString(),
        },
        ascendingOrder: false,
        pageSize: 1,
      } as any);
      const kg = (records[0] as any)?.weight?.inKilograms;
      return typeof kg === 'number' ? kg : null;
    } catch {
      return null;
    }
  },

  async writeBodyweightKg(kg, at = new Date()) {
    const hc = load();
    if (!hc || !(await ensureInit(hc))) return false;
    try {
      await hc.insertRecords([
        {
          recordType: 'Weight',
          weight: { value: kg, unit: 'kilograms' },
          time: at.toISOString(),
        } as any,
      ]);
      return true;
    } catch (err) {
      console.warn('[health] writeBodyweight failed', err);
      return false;
    }
  },
};

export const healthConnectOrUnavailable = (): HealthBridge =>
  load() ? healthConnect : UNAVAILABLE;
