/**
 * The app's own health interface.
 *
 * Deliberately platform-neutral and much smaller than either native API: the
 * app only ever needs to write a finished session, read bodyweight, and write
 * bodyweight. Keeping the surface this narrow is what makes the two very
 * different platform SDKs substitutable behind one type.
 */

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export interface WorkoutSummary {
  /** Our own workout id, written as metadata so a re-sync can't duplicate it. */
  id: string;
  name: string;
  startedAt: Date;
  finishedAt: Date;
  /**
   * Only ever passed when it came from a real measurement (an Apple Watch
   * session, say). We never estimate it: writing invented calorie data into
   * someone's permanent health record would be worse than writing none.
   */
  activeEnergyKcal?: number;
}

export interface HealthBridge {
  /** Whether this platform has a health store and the native module is present. */
  isAvailable(): Promise<boolean>;
  getPermissionState(): Promise<PermissionState>;
  /** Shows the system permission sheet. Resolves to whether we can now write. */
  requestPermissions(): Promise<boolean>;
  saveWorkout(summary: WorkoutSummary): Promise<boolean>;
  readLatestBodyweightKg(): Promise<number | null>;
  writeBodyweightKg(kg: number, at?: Date): Promise<boolean>;
}

/** Used on web, in Expo Go, and anywhere the native module failed to load. */
export const UNAVAILABLE: HealthBridge = {
  isAvailable: async () => false,
  getPermissionState: async () => 'unavailable',
  requestPermissions: async () => false,
  saveWorkout: async () => false,
  readLatestBodyweightKg: async () => null,
  writeBodyweightKg: async () => false,
};
