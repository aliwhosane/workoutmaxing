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
 * One shape for every card, so the words underneath sit on the same line as you
 * swipe. What goes in it differs: where there is a real action to show, it is a
 * recording of the actual app doing it — cropped to just the part that moves,
 * because a whole phone screen shrunk to this size is unreadable. Where there
 * is nothing to film — an absence like "no account needed" — it holds a glyph
 * rather than a staged demonstration of nothing happening.
 *
 * The aspect ratio is the crop the clips were cut to; keep them in step. They
 * are cut at the full width of the phone they were recorded on, so the app's
 * own screen gutter keeps content clear of the well's rounded corners.
 */
const WELL_ASPECT = 1242 / 605;
const WELL_MAX_WIDTH = 340;

function Well({ children }: { children: React.ReactNode }) {
  return <View style={styles.well}>{children}</View>;
}

/** A recording of the app, played in the well. */
function Clip({ source }: { source: ImageSource }) {
  return (
    <Image
      source={source}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      // Decoded once and kept — these loop for as long as the card is on
      // screen, and re-decoding a GIF every swipe is visible as a stutter.
      cachePolicy="memory-disk"
      transition={motion.fade}
    />
  );
}

function ShieldGlyph() {
  return (
    <Svg width={88} height={88} viewBox="0 0 72 72">
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
    <Svg width={88} height={88} viewBox="0 0 72 72">
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
    clip: require('../assets/onboarding/todays-plan.gif') as ImageSource,
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
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

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
            <Well>
              {slide.clip ? <Clip source={slide.clip} /> : slide.glyph?.()}
            </Well>
            <Spacer h={space.xxl} />
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
    maxWidth: WELL_MAX_WIDTH,
    aspectRatio: WELL_ASPECT,
    borderRadius: radius.lg,
    // The clips are recordings of a black app, so the well only shows through
    // behind a glyph — but it has to be painted either way, or the rounded
    // corners have nothing to clip against on Android.
    backgroundColor: palette.surface,
    overflow: 'hidden',
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
