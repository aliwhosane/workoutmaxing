import { Platform, View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { palette, radius } from './tokens';

/**
 * A floating surface — the tab bar, the docked primary action, the rest timer.
 *
 * These are the only things in the app that sit *above* content rather than in
 * it, and they are the only places a material belongs. Everything else stays a
 * flat black sheet.
 *
 * The material is chosen per platform, because the two platforms genuinely
 * disagree about what a floating surface should be:
 *
 *   iOS 26+   Liquid Glass. A real UIVisualEffectView that refracts and blurs
 *             the content scrolling underneath it.
 *   Android   Material 3 uses *tonal* elevation, not blur — a surface lifts by
 *             getting lighter, not by becoming translucent. So we raise the
 *             tone and add elevation rather than faking glass.
 *   Older iOS Falls back to the same opaque tonal surface as Android.
 *
 * This is deliberately a material swap and nothing more. No layout moves, no
 * control changes shape, and nothing is added to the screen.
 */

type GlassModule = typeof import('expo-glass-effect');

let glass: GlassModule | null | undefined;

function loadGlass(): GlassModule | null {
  if (glass !== undefined) return glass;
  try {
    glass = require('expo-glass-effect') as GlassModule;
  } catch {
    // Not present in Expo Go on older runtimes; the tonal surface is a fine app.
    glass = null;
  }
  return glass;
}

/** True only on an OS that can actually render Liquid Glass. */
export const liquidGlassAvailable = (): boolean => {
  if (Platform.OS !== 'ios') return false;
  const mod = loadGlass();
  try {
    return !!mod?.isLiquidGlassAvailable?.();
  } catch {
    return false;
  }
};

export interface SurfaceProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * `chrome` is for bars that span the screen edge-to-edge and should read as
   * part of the window; `panel` is for a rounded, inset surface.
   */
  variant?: 'chrome' | 'panel';
  /** Corner radius. Ignored for `chrome`, which takes the screen's own edges. */
  cornerRadius?: number;
}

export function Surface({ children, style, variant = 'panel', cornerRadius }: SurfaceProps) {
  const r = variant === 'chrome' ? 0 : cornerRadius ?? radius.lg;

  if (liquidGlassAvailable()) {
    const { GlassView } = loadGlass()!;
    return (
      <GlassView
        // `regular` is the material Apple uses for bars and controls; `clear`
        // is for media, where the content behind should stay readable.
        glassEffectStyle="regular"
        // The app is dark by design, so the glass is pinned dark rather than
        // following a system appearance the rest of the UI ignores.
        colorScheme="dark"
        style={[{ borderRadius: r, overflow: 'hidden' }, style]}
      >
        {children}
      </GlassView>
    );
  }

  /**
   * Material 3 lifts a surface by *tone* — it gets lighter, not translucent —
   * so on Android a bar has to be a step above the background or it simply is
   * the background and the separation disappears entirely.
   *
   * On older iOS the convention is the opposite: bars sit flush with the window
   * and are separated by blur, which we cannot do without a heavier dependency.
   * Painting them a lighter grey there would look wrong, so they stay flush.
   */
  const chromeColor = Platform.OS === 'android' ? palette.surface : palette.void;

  return (
    <View
      style={[
        styles.tonal,
        {
          borderRadius: r,
          backgroundColor: variant === 'chrome' ? chromeColor : palette.surface,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  tonal: {
    ...Platform.select({
      android: { elevation: 3 },
      default: {},
    }),
  },
});
