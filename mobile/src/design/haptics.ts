import * as Haptics from 'expo-haptics';

/**
 * The app's feedback vocabulary.
 *
 * Everything you can press answers back through the Taptic engine, so a tap can
 * be confirmed without looking at the screen — which is the whole point when
 * your hands are shaking and the phone is on the floor next to a barbell.
 *
 * It lives here rather than inside `Touch` because not every control in the app
 * is one of ours: the tab bar is the operating system's, and a switch is a
 * platform control. Those still have to speak the same language, and the only
 * way to guarantee that is for there to be exactly one place that decides what
 * each kind feels like.
 *
 *   light      something small moved — a row, a chip, a set uncompleted
 *   medium     a deliberate action — save, finish, delete
 *   heavy      the heaviest confirmations
 *   success    it worked — a set logged, a rest finished
 *   selection  a choice among options changed — a tab, a switch, a segment
 *
 * `selection` is the interesting one. On iOS it is the dedicated selection
 * generator, which is the idiom the platform expects for a tab or a picker; on
 * Android expo-haptics gives it exactly the same waveform as a light impact, so
 * it lands identically to every other tap in the app rather than standing out.
 */
export type Feedback = 'light' | 'medium' | 'heavy' | 'success' | 'selection' | 'none';

export function feedback(kind: Feedback): void {
  // Fire and forget, and never let it throw. A device with no vibrator rejects
  // these, and a haptic failing is not a reason for a press to fail with it.
  const swallow = () => {};
  switch (kind) {
    case 'light':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(swallow); return;
    case 'medium':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(swallow); return;
    case 'heavy':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(swallow); return;
    case 'success':
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(swallow); return;
    case 'selection':
      Haptics.selectionAsync().catch(swallow); return;
    case 'none':
      return;
  }
}
