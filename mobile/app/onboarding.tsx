import { useCallback, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image, type ImageSource } from 'expo-image';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { Text, Touch, Button, Spacer } from '../src/design/primitives';
import { palette, space, radius, touch, motion } from '../src/design/tokens';
import { kvSet } from '../src/db/client';

/** Bumped only if the flow changes enough that returning users should see it again. */
const ONBOARDING_KEY = 'onboarding_seen_v1';

/**
 * The media well.
 *
 * A box of the same size on every card, so the words underneath sit on the same
 * line as you swipe. What goes in it differs: where there is a real action to
 * show, it is a recording of the actual app doing it. Where there is nothing to
 * film — an absence like "no account needed" — it holds a glyph rather than a
 * staged demonstration of nothing happening.
 *
 * Clips are fitted rather than cropped, so each keeps its own shape and is
 * drawn as large as the box allows. Everything here is black on black, so the
 * letterboxing that leaves is invisible — which is why the box itself is not
 * painted, and a clip reads as the app rather than as a framed screenshot.
 *
 * It takes a little over half the screen. That is deliberately generous: these
 * are whole phone screens shrunk down, and below about this size the exercise
 * names stop being readable and the clip stops teaching anything.
 */
const WELL_HEIGHT_FRACTION = 0.54;

/** Sized against the well rather than the old badge, or it swims in the box. */
const GLYPH = 148;

function Well({ height, children }: { height: number; children: React.ReactNode }) {
  return <View style={[styles.well, { height }]}>{children}</View>;
}

/** A recording of the app, played in the well. */
function Clip({ source }: { source: ImageSource }) {
  return (
    <Image
      source={source}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      // Decoded once and kept — these loop for as long as the card is on
      // screen, and re-decoding a GIF every swipe is visible as a stutter.
      cachePolicy="memory-disk"
      transition={motion.fade}
    />
  );
}

function ShieldGlyph() {
  return (
    <Svg width={GLYPH} height={GLYPH} viewBox="0 0 72 72">
      <Path
        d="M36 14L54 21V34C54 46 46.5 54.5 36 58C25.5 54.5 18 46 18 34V21L36 14Z"
        stroke={palette.ink45}
        strokeWidth={2}
        strokeLinejoin="round"
        fill="none"
      />
      <Path d="M28 35.5L34 41.5L45 29" stroke={palette.live} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

function ProgressGlyph() {
  return (
    <Svg width={GLYPH} height={GLYPH} viewBox="0 0 72 72">
      <Path d="M18 46L29 35L38 42L54 22" stroke={palette.ink45} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Circle cx={18} cy={46} r={3} fill={palette.ink45} />
      <Circle cx={29} cy={35} r={3} fill={palette.ink45} />
      <Circle cx={38} cy={42} r={3} fill={palette.ink45} />
      <Circle cx={54} cy={22} r={3.5} fill={palette.live} />
    </Svg>
  );
}

/**
 * Each card carries either a `clip` — a recording of the app performing the
 * thing the words describe — or a `glyph`, where there is no such thing to
 * record. Never both.
 */
type Slide = {
  title: string;
  body: string;
  clip?: ImageSource;
  glyph?: () => React.ReactElement;
};

const SLIDES: Slide[] = [
  {
    clip: require('../assets/onboarding/log-a-set.gif') as ImageSource,
    title: 'Log a set in one tap',
    body: "Weight, reps, done. Nothing else gets in the way while you're training.",
  },
  {
    clip: require('../assets/onboarding/pick-a-plan.gif') as ImageSource,
    title: 'A plan for every day',
    body: 'Pick a program and the app tells you exactly what to lift, every session, automatically.',
  },
  {
    glyph: ShieldGlyph,
    title: 'No sign-in required',
    body: 'Everything runs on your phone. Sync is optional, in Settings, whenever you want it.',
  },
  {
    glyph: ProgressGlyph,
    title: "Progress you don't have to plan",
    body: 'The app watches your history and adjusts your next weights for you.',
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  // Off the window rather than a constant, so a small phone shrinks the clip
  // instead of pushing the words off the bottom.
  const wellHeight = Math.round(height * WELL_HEIGHT_FRACTION);

  const finish = useCallback(() => {
    kvSet(ONBOARDING_KEY, '1').catch(() => {});
    router.replace('/');
  }, [router]);

  const onScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }, [width]);

  const next = useCallback(() => {
    if (index === SLIDES.length - 1) { finish(); return; }
    const target = index + 1;
    scrollRef.current?.scrollTo({ x: target * width, animated: true });
    setIndex(target);
  }, [index, width, finish]);

  const last = index === SLIDES.length - 1;

  return (
    <View style={styles.screen}>
      <Touch
        style={[styles.skip, { top: insets.top + space.sm }]}
        onPress={finish}
        haptic="light"
        scaleTo={0.9}
        hitSlop={{ top: space.sm, bottom: space.sm, left: space.md, right: space.md }}
      >
        <Text variant="label" color={palette.ink45}>Skip</Text>
      </Touch>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide) => (
          <View key={slide.title} style={[styles.slide, { width, paddingTop: insets.top }]}>
            <Well height={wellHeight}>
              {slide.clip ? <Clip source={slide.clip} /> : slide.glyph?.()}
            </Well>
            <Spacer h={space.xl} />
            <Text variant="title" center>{slide.title}</Text>
            <Spacer h={space.md} />
            <Text variant="body" color={palette.ink45} center>{slide.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.dots}>
          {SLIDES.map((slide, i) => (
            <View
              key={slide.title}
              style={[styles.dot, i === index && styles.dotActive]}
            />
          ))}
        </View>
        <Spacer h={space.lg} />
        <Button title={last ? 'Get started' : 'Next'} onPress={next} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.void },
  skip: {
    position: 'absolute',
    right: space.screen,
    zIndex: 1,
    height: touch.min,
    justifyContent: 'center',
  },
  slide: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
  },
  well: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  foot: { paddingHorizontal: space.screen },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.ink25,
  },
  dotActive: {
    width: 20,
    backgroundColor: palette.live,
  },
});
