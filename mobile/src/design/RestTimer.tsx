import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, cancelAnimation,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Text, Touch } from './primitives';
import { palette, space, radius, motion } from './tokens';

/**
 * Rest timer.
 *
 * Deliberately not a modal, not a full screen, and not something you have to
 * start. It appears the instant a set is logged, drains left-to-right so you
 * can read it from across the room, and taps away. When it reaches zero it
 * buzzes your wrist — the point is that you should never need to look at it.
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

    progress.value = 1;
    progress.value = withTiming(0, { duration: seconds * 1000, easing: Easing.linear });

    const tick = setInterval(() => {
      const left = Math.max(0, Math.round((deadline.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && !fired.current) {
        fired.current = true;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onDone?.();
      }
    }, 250);

    return () => { clearInterval(tick); cancelAnimation(progress); };
  }, [seconds, onDone, progress]);

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const done = remaining === 0;

  return (
    <Touch style={styles.bar} onPress={onSkip} scaleTo={0.99} haptic="light">
      <Animated.View
        style={[styles.fill, fill, done && { backgroundColor: palette.live }]}
        pointerEvents="none"
      />
      <View style={styles.content} pointerEvents="none">
        <Text variant="micro" color={done ? palette.liveInk : palette.ink45}>
          {done ? 'READY' : 'REST'}
        </Text>
        <Text variant="bodyMed" color={done ? palette.liveInk : palette.ink} numeric>
          {mmss(remaining)}
        </Text>
      </View>
    </Touch>
  );
}

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const styles = StyleSheet.create({
  bar: {
    height: 52, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: palette.surface, justifyContent: 'center',
  },
  fill: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    backgroundColor: palette.surfaceHigh,
  },
  content: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
});
