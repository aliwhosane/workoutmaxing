import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { feedback } from '../../src/design/haptics';
import { palette } from '../../src/design/tokens';

/**
 * The tab bar.
 *
 * This is the *system's* tab bar rather than one we draw, on both platforms.
 * On iOS 26 that means a floating Liquid Glass island — detached from the
 * screen edge, capsule-ended, contracting as content scrolls under it — which
 * is not something you approximate convincingly by styling a view. On Android
 * the same component yields proper Material bottom navigation, with labels
 * under the selected destination as that platform expects.
 *
 * The trade is that icons come from each platform's own set: SF Symbols on
 * iOS, Material glyphs on Android. For navigation chrome specifically that is
 * the right call — a tab bar should look like the operating system's, not like
 * ours. Everything inside the app stays drawn by us.
 *
 * Four destinations, never more, each one a noun the user already has a word for.
 *
 * Being the system's bar, it does not answer back the way everything else in
 * the app does: Material's bottom navigation has no haptic of its own, so on
 * Android switching tabs was the one press in the app that felt dead. The
 * navigator emits `tabPress` for every destination, so one listener here gives
 * the whole bar the same voice as the rest of the app on both platforms.
 */
export default function TabLayout() {
  return (
    <NativeTabs
      screenListeners={{ tabPress: () => feedback('selection') }}
      tintColor={palette.live}
      iconColor={palette.ink45}
      labelStyle={{ color: palette.ink45 }}
      // iOS 26 contracts the island to a pill as you scroll down into content.
      minimizeBehavior="onScrollDown"
      blurEffect="systemChromeMaterialDark"
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock" md="schedule" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="programs">
        <NativeTabs.Trigger.Label>Plans</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet" md="list" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="library">
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="dumbbell" md="fitness_center" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.bar" md="bar_chart" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
