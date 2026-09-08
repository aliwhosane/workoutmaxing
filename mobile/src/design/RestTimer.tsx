import { useEffect, useRef, useState } from 'react';
import { AppState, View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, cancelAnimation,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Text, Touch } from './primitives';
import { liquidGlassAvailable } from './Surface';
import { palette, space, radius, touch } from './tokens';

/**
 * Rest timer.
 *
 * Deliberately not a modal, not a full screen, and not something you have to
 * start. It takes the dock — the same slot, size and shape as the button it
 * stands in for, so nothing on the screen moves when a rest begins — and every
 * set above it stays live: you can ignore the clock entirely and start the next
 * set whenever you want. A tap anywhere on the bar throws it away.
 *
 * What it shows is one accent rail draining right to left. A number has to be
 * read; a bar that is visibly half gone does not, which is the whole point when
 * it is across the room on a bench and you are under one.
 *
 * Time is computed from a wall-clock deadline, not by decrementing a counter,
 * so backgrounding the app or a dropped frame can't make rest drift.
 */
export function RestTimer({
  seconds, onDone, onSkip,
}: { seconds: number; onDone?: () => void; onSkip: () => void }) {
  const deadline = useRef(Date.now() + seconds * 1000);
  const [remaining, setRemaining] = useState(seconds);
  const progress = useSharedValue(1);
  const fired = useRef(false);

  useEffect(() => {
    deadline.current = Date.now() + seconds * 1000;
    fired.current = false;
    setRemaining(seconds);

    /**
     * The rail glides rather than stepping once a second, so it animates over
     * whatever is genuinely left rather than over `seconds` — which is the same
     * thing on a fresh rest, and the correct thing on a resumed one.
     */
    const run = () => {
      const left = deadline.current - Date.now();
      cancelAnimation(progress);
      progress.value = Math.max(0, Math.min(1, left / (seconds * 1000)));
      if (left > 0) {
        progress.value = withTiming(0, { duration: left, easing: Easing.linear });
      }
    };
    run();

    const tick = setInterval(() => {
      const left = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && !fired.current) {
        fired.current = true;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onDone?.();
      }
    }, 250);

    /**
     * Reanimated animations run on the UI thread, which is frozen while the app
     * is in the background. Answer a message mid-rest and the rail would come
     * back claiming more time than the clock does, so it is re-derived from the
     * deadline every time the app returns to the foreground.
     */
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') run(); });

    return () => { clearInterval(tick); cancelAnimation(progress); sub.remove(); };
  }, [seconds, onDone, progress]);

  const rail = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const done = remaining === 0;

  /**
   * Glass while it counts, so the sets scrolling underneath stay visible
   * through the dock; solid accent the instant rest is up, because that is the
   * one moment this bar is asking for something rather than reporting.
   */
  const plate = done
    ? palette.live
    : liquidGlassAvailable() ? 'transparent' : palette.surface;

  return (
    <Touch
      style={[styles.bar, { backgroundColor: plate }]}
      onPress={onSkip}
      scaleTo={0.99}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={done ? 'Rest complete. Dismiss.' : `Resting, ${remaining} seconds left. Skip.`}
    >
      <View style={[styles.content, !done && styles.contentAboveRail]} pointerEvents="none">
        <Text variant="micro" color={done ? palette.liveInk : palette.ink45}>
          {done ? 'READY' : 'REST'}
        </Text>
        <View style={styles.readout}>
          <Text variant="title" color={done ? palette.liveInk : palette.ink} numeric>
            {mmss(remaining)}
          </Text>
          {/* Says out loud that the clock is optional. */}
          {!done && <Text variant="micro" color={palette.ink45}>SKIP</Text>}
        </View>
      </View>

      {/* The reverse loading bar: full width at the start, gone at zero. What
          you read is the length of the accent, not the position of a marker.
          It runs the same gutter as the text above it rather than bleeding to
          the bar's edges, where the corner radius would clip its ends. */}
      {!done && (
        <View style={styles.track} pointerEvents="none">
          <Animated.View style={[styles.rail, rail]} />
        </View>
      )}
    </Touch>
  );
}

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const styles = StyleSheet.create({
  bar: {
    // The dock's primary slot, to the point — same height and radius as the
    // button this replaces, so starting a rest moves nothing on the screen.
    height: touch.primary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  /** Gives the rail its own room, so the readout stays centred above it. */
  contentAboveRail: { paddingBottom: space.lg },
  readout: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  track: {
    position: 'absolute', left: space.lg, right: space.lg, bottom: space.md,
    height: space.sm,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: palette.ink12,
  },
  rail: { height: '100%', borderRadius: radius.pill, backgroundColor: palette.live },
});
