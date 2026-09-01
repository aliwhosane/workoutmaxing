import { View, StyleSheet, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text, Touch } from './primitives';
import { palette, space, radius, touch } from './tokens';

/**
 * Choosing a rest length.
 *
 * Two jobs, one sheet: starting a rest by hand right now, and setting the rest
 * an exercise takes automatically after every set. They are the same decision —
 * "how long" — so they are the same control, and learning one teaches the other.
 *
 * Deliberately not a route. Picking a rest is a half-second aside in the middle
 * of a session; pushing a screen would animate the logger away and back, and
 * lose the scroll position the lifter was holding.
 */

/** The presets. A lifter's rest is a round number — nobody rests 47 seconds. */
export const REST_PRESETS = [30, 60, 90, 120, 180, 300] as const;

/** `2:00`, and `0:45` — always mm:ss so the digits never change width. */
export const restLabel = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** A clock. Used for anything to do with rest, and nothing else. */
export function TimerGlyph({ size = 20, color = palette.ink45 }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={13} r={8} stroke={color} strokeWidth={1.8} fill="none" />
      <Path
        d="M12 9v4l2.5 2M9.5 2.5h5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

export interface RestPickerProps {
  title: string;
  /** The line under the title — say what picking here will actually do. */
  subtitle?: string;
  /** Current choice in seconds. 0 means off; null means nothing chosen yet. */
  value?: number | null;
  /** Offer "Off" — only meaningful for the automatic rest, never for a manual one. */
  allowOff?: boolean;
  onPick: (seconds: number) => void;
  onClose: () => void;
}

export function RestPicker({
  title, subtitle, value, allowOff, onPick, onClose,
}: RestPickerProps) {
  const insets = useSafeAreaInsets();

  return (
    <Animated.View
      style={StyleSheet.absoluteFill}
      entering={FadeIn.duration(140)}
      exiting={FadeOut.duration(140)}
    >
      {/* Anywhere off the sheet dismisses it. A rest picker should never be
          something you have to escape from. */}
      <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onClose} />

      <Animated.View
        style={styles.dock}
        entering={SlideInDown.springify().damping(26).stiffness(190)}
        exiting={SlideOutDown.duration(160)}
      >
        {/* Opaque, not glass. A sheet is content, and glass belongs only on
            things that float above content — a bar or a dock. Over a dark
            screen the material is so nearly invisible that the set rows read
            straight through the presets, which is unusable. */}
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <Text variant="heading">{title}</Text>
          {subtitle && (
            <Text variant="caption" color={palette.ink45} style={{ marginTop: space.xs }}>
              {subtitle}
            </Text>
          )}

          <View style={styles.grid}>
            {REST_PRESETS.map((s) => (
              <Chip
                key={s}
                label={restLabel(s)}
                selected={value === s}
                onPress={() => onPick(s)}
              />
            ))}
            {allowOff && (
              <Chip label="Off" selected={value === 0} onPress={() => onPick(0)} />
            )}
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * One preset. Sized for a hand that is shaking, which is why these are far
 * larger than a chip normally needs to be.
 */
function Chip({
  label, selected, onPress,
}: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Touch
      style={[styles.chip, selected && styles.chipOn]}
      onPress={onPress}
      haptic="medium"
      scaleTo={0.94}
    >
      <Text
        variant="bodyMed"
        color={selected ? palette.liveInk : palette.ink}
        numeric
      >
        {label}
      </Text>
    </Touch>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: palette.scrim },
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: {
    paddingTop: space.xl,
    paddingHorizontal: space.screen,
    backgroundColor: palette.surface,
    // A sheet meets the screen edge, so only the top corners are rounded —
    // rather than hanging the surface off the bottom on a negative margin,
    // which on Android would put anything down there outside its parent's
    // bounds and stop it receiving touches.
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: space.sm,
    marginTop: space.lg,
  },
  chip: {
    // Three to a row at any phone width, without measuring anything.
    flexGrow: 1, flexBasis: '30%',
    height: touch.comfortable,
    borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.ink06,
  },
  chipOn: { backgroundColor: palette.live },
});
