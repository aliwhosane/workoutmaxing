/**
 * Design tokens.
 *
 * Principle: the app is a black sheet of glass. Content is the only thing that
 * emits light. No borders, no cards, no chrome — hierarchy comes from type
 * weight, size and opacity alone. Colour is used exactly once per screen, to
 * mark the single thing you are meant to touch.
 */

export const palette = {
  // The canvas. Not pure black — pure black kills depth on OLED shadows.
  void: '#0A0A0B',
  surface: '#141416',
  surfaceHigh: '#1E1E21',

  // Ink. Opacity-stepped, never a different hue.
  ink: '#FFFFFF',
  ink70: 'rgba(255,255,255,0.70)',
  ink45: 'rgba(255,255,255,0.45)',
  ink25: 'rgba(255,255,255,0.25)',
  ink12: 'rgba(255,255,255,0.12)',
  ink06: 'rgba(255,255,255,0.06)',

  // The one accent. Used for the primary action and nothing else.
  live: '#D6FF3F',
  liveInk: '#0A0A0B',

  // Semantic, used sparingly in history/progress only.
  gain: '#4ADE80',
  strain: '#FF6B5A',
} as const;

/**
 * 4pt base grid. Every spatial value in the app is one of these.
 * If a value isn't here, it's wrong.
 */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  huge: 48,
  screen: 20, // horizontal screen gutter — the app's single margin
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

/**
 * Type scale. Two roles only:
 *   - `display` for numbers you read mid-set, at arm's length, sweating.
 *   - `text`    for everything else.
 * Numbers are always tabular so they don't jitter as they count.
 */
export const type = {
  hero:    { fontSize: 56, lineHeight: 58, fontWeight: '700', letterSpacing: -1.8 },
  display: { fontSize: 40, lineHeight: 44, fontWeight: '700', letterSpacing: -1.2 },
  title:   { fontSize: 28, lineHeight: 33, fontWeight: '700', letterSpacing: -0.7 },
  heading: { fontSize: 20, lineHeight: 25, fontWeight: '600', letterSpacing: -0.4 },
  body:    { fontSize: 17, lineHeight: 24, fontWeight: '400', letterSpacing: -0.2 },
  bodyMed: { fontSize: 17, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 },
  label:   { fontSize: 15, lineHeight: 20, fontWeight: '500', letterSpacing: -0.1 },
  caption: { fontSize: 13, lineHeight: 17, fontWeight: '500', letterSpacing: 0 },
  micro:   { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.6 },
} as const;

/**
 * Motion. Everything is spring-based — nothing in the physical world moves
 * on a bezier curve. Durations exist only for opacity.
 */
export const motion = {
  // Reanimated spring configs
  snap:   { damping: 30, stiffness: 400, mass: 0.7 },   // buttons, taps
  settle: { damping: 26, stiffness: 190, mass: 0.9 },   // sheets, transitions
  drift:  { damping: 40, stiffness: 90,  mass: 1.2 },   // ambient, timers
  fade:   160,
} as const;

/**
 * Minimum touch target. 44 is Apple's floor; we use 56 for anything you
 * press while your hands are shaking and your heart rate is at 170.
 */
export const touch = {
  min: 44,
  comfortable: 56,
  primary: 68,
} as const;
