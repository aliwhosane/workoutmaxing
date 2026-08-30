import { useSyncExternalStore } from 'react';
import { kvGet, kvSet } from '../db/client';
import type { DistanceUnit, WeightUnit } from './units';

/**
 * User preferences.
 *
 * Read synchronously by every screen that renders a number, so they are hydrated
 * once at boot (alongside the database) and then held in memory. Writes persist
 * to the `kv` table in the background — a preference is never worth making the
 * UI wait.
 */

export interface Settings {
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  /** Mirror finished sessions into Apple Health / Health Connect. */
  healthSync: boolean;
  /** Default rest when a program doesn't prescribe one. */
  defaultRestSeconds: number;
}

/**
 * Guessed from the device's locale so the app is already right for most people
 * before they open settings. The United States, Liberia and Myanmar are the
 * only countries not on the metric system; everyone else gets kg and km.
 */
function localeDefaults(): Pick<Settings, 'weightUnit' | 'distanceUnit'> {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    const region = locale.split('-').pop()?.toUpperCase() ?? '';
    const imperial = region === 'US' || region === 'LR' || region === 'MM';
    return imperial
      ? { weightUnit: 'lb', distanceUnit: 'mi' }
      : { weightUnit: 'kg', distanceUnit: 'km' };
  } catch {
    return { weightUnit: 'kg', distanceUnit: 'km' };
  }
}

const DEFAULTS: Settings = {
  ...localeDefaults(),
  healthSync: false,
  defaultRestSeconds: 120,
};

const KEY = 'settings';

let settings: Settings = DEFAULTS;
const listeners = new Set<() => void>();

/** Called once at boot, before the first screen renders. */
export async function loadSettings(): Promise<void> {
  try {
    const raw = await kvGet(KEY);
    if (raw) settings = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // A corrupt blob must not stop the app booting — defaults are always valid.
    settings = DEFAULTS;
  }
  emit();
}

function emit() {
  settings = { ...settings };
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => settings,
  );
}

/** Non-reactive read, for use outside components. */
export const getSettings = () => settings;

export function updateSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  emit();
  // Fire and forget: the in-memory value is already authoritative for this
  // session, and a failed write costs at most one preference on next launch.
  kvSet(KEY, JSON.stringify(settings)).catch(() => {});
}
