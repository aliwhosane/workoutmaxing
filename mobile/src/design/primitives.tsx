import { forwardRef } from 'react';
import {
  Text as RNText, type TextProps as RNTextProps,
  Pressable as RNPressable, type PressableProps,
  View, type ViewStyle, type StyleProp, StyleSheet,
} from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { feedback, type Feedback } from './haptics';
import { palette, type as t, motion, radius, space, touch } from './tokens';

/* ------------------------------------------------------------------ Text */

type Variant = keyof typeof t;
interface TextProps extends RNTextProps {
  variant?: Variant;
  color?: string;
  center?: boolean;
  /** Tabular figures — use for anything that counts, so digits don't jitter. */
  numeric?: boolean;
}

export function Text({
  variant = 'body', color = palette.ink, center, numeric, style, ...rest
}: TextProps) {
  return (
    <RNText
      {...rest}
      style={[
        t[variant] as any,
        { color },
        center && { textAlign: 'center' },
        numeric && { fontVariant: ['tabular-nums'] },
        style,
      ]}
    />
  );
}

/* -------------------------------------------------------------- Pressable */

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

interface TouchProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** How far it depresses. Bigger targets move less — heavier things move less. */
  scaleTo?: number;
  haptic?: Feedback;
}

/**
 * Every interactive surface in the app. Presses are physical: the element
 * compresses under the finger on a spring and reports back through the Taptic
 * engine, so you can confirm a tap landed without looking at the screen —
 * which is the whole point when you are mid-set.
 */
export const Touch = forwardRef<View, TouchProps>(function Touch(
  { style, scaleTo = 0.96, haptic = 'light', onPressIn, onPress, children, ...rest }, ref,
) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(1 - pressed.value * (1 - scaleTo), motion.snap) }],
    opacity: withTiming(1 - pressed.value * 0.12, { duration: 80 }),
  }));

  return (
    <AnimatedPressable
      ref={ref as any}
      {...rest}
      onPressIn={(e) => {
        pressed.value = 1;
        feedback(haptic);
        onPressIn?.(e);
      }}
      onPressOut={() => { pressed.value = 0; }}
      onPress={onPress}
      style={[style as any, animatedStyle]}
    >
      {children as any}
    </AnimatedPressable>
  );
});

/* ---------------------------------------------------------------- Button */

interface ButtonProps extends TouchProps {
  title: string;
  tone?: 'primary' | 'quiet' | 'ghost';
  disabled?: boolean;
}

export function Button({ title, tone = 'primary', disabled, style, ...rest }: ButtonProps) {
  const tones = {
    primary: { bg: palette.live,      fg: palette.liveInk },
    quiet:   { bg: palette.surfaceHigh, fg: palette.ink },
    ghost:   { bg: 'transparent',     fg: palette.ink70 },
  }[tone];

  return (
    <Touch
      {...rest}
      disabled={disabled}
      // The tone picks the feedback — the primary action hits harder than a
      // quiet one — but an explicit `haptic` still wins, which it could not
      // when this was set unconditionally after the spread.
      haptic={rest.haptic ?? (tone === 'primary' ? 'medium' : 'light')}
      scaleTo={0.97}
      style={[
        styles.button,
        { backgroundColor: tones.bg, opacity: disabled ? 0.35 : 1 },
        style as ViewStyle,
      ]}
    >
      <Text variant="bodyMed" color={tones.fg}>{title}</Text>
    </Touch>
  );
}

/* ----------------------------------------------------------------- Misc */

/** A hairline. The only line in the app — 0.5pt at 12% white, never a border. */
export const Rule = ({ inset = 0 }: { inset?: number }) => (
  <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.ink12, marginLeft: inset }} />
);

export const Spacer = ({ h }: { h: number }) => <View style={{ height: h }} />;

const styles = StyleSheet.create({
  button: {
    height: touch.primary,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
});
