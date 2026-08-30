import { useEffect } from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay,
  Easing, cancelAnimation,
} from 'react-native-reanimated';
import { palette, radius } from './tokens';

const AnimatedImage = Animated.createAnimatedComponent(Image);

/**
 * The exercise demonstration.
 *
 * The catalogue gives us two photographs per movement — the start and the end
 * position. Rather than shipping video or hunting down GIFs of uncertain
 * provenance, we cross-fade between the two on a real lifting tempo: a slow
 * eccentric, a pause under load, a faster concentric. The eye fills in the
 * middle, and the result reads as a loop of the movement while staying two
 * cached JPEGs that work offline and weigh nothing.
 *
 * `paused` stops the animation for offscreen list rows so a 900-row library
 * isn't running 900 timelines.
 */
export function ExerciseLoop({
  frames, size = 72, radiusOverride, paused = false, style,
}: {
  frames: string[];
  size?: number;
  radiusOverride?: number;
  paused?: boolean;
  style?: ViewStyle;
}) {
  // 0 = start position fully visible, 1 = end position fully visible.
  const phase = useSharedValue(0);

  useEffect(() => {
    if (paused || frames.length < 2) {
      cancelAnimation(phase);
      phase.value = 0;
      return;
    }
    phase.value = withRepeat(
      withSequence(
        // eccentric — lowering, deliberately the slowest part
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.cubic) }),
        // the pause at the bottom, where the work actually happens
        withDelay(260, withTiming(1, { duration: 0 })),
        // concentric — driving back up, quicker
        withTiming(0, { duration: 780, easing: Easing.out(Easing.cubic) }),
        withDelay(420, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(phase);
  }, [paused, frames.length, phase]);

  const endStyle = useAnimatedStyle(() => ({ opacity: phase.value }));

  const r = radiusOverride ?? radius.md;
  const box = { width: size, height: size, borderRadius: r };

  return (
    <View style={[styles.frame, box, style]}>
      <Image
        source={frames[0]}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={180}
        cachePolicy="memory-disk"
      />
      {frames[1] && (
        <AnimatedImage
          source={frames[1]}
          style={[StyleSheet.absoluteFill, endStyle]}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: palette.surfaceHigh,
  },
});
