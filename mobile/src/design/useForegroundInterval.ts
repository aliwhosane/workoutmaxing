import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * An interval that only runs while the app is in front.
 *
 * Both clocks in the app — the session timer and the rest timer — exist to
 * redraw a number on screen. Neither is what actually keeps time: that is a
 * wall-clock deadline, read with `Date.now()` whenever the value is needed. So
 * a tick that fires while nobody is looking at the screen changes nothing and
 * costs a React render.
 *
 * That matters on Android, where the JavaScript thread keeps running while the
 * app is merely backgrounded — a logger left open in a pocket would otherwise
 * re-render once a second until the app is killed. (iOS suspends the app
 * outright, so it has always behaved this way; this makes Android match.)
 *
 * Because the value is re-derived rather than accumulated, pausing is free:
 * `onTick` is called the moment the app comes back, so the first frame the
 * user sees is already correct rather than up to `ms` stale.
 *
 * The callbacks are held in a ref, so passing an inline arrow does not restart
 * the interval on every render.
 */
export function useForegroundInterval(
  ms: number,
  onTick: () => void,
  /** Runs on the background → foreground transition, before the catch-up tick. */
  onResume?: () => void,
): void {
  const tick = useRef(onTick);
  const resume = useRef(onResume);
  useEffect(() => {
    tick.current = onTick;
    resume.current = onResume;
  });

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (id !== null) return;
      tick.current();
      id = setInterval(() => tick.current(), ms);
    };

    const stop = () => {
      if (id === null) return;
      clearInterval(id);
      id = null;
    };

    if (AppState.currentState === 'active') start();

    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') { stop(); return; }
      // Only on a real return to the front. `start` is idempotent, but the
      // resume hook must not fire for an 'inactive' blip that never stopped
      // us — the notification shade, or a permission sheet.
      if (id === null) { resume.current?.(); start(); }
    });

    return () => { stop(); sub.remove(); };
  }, [ms]);
}
