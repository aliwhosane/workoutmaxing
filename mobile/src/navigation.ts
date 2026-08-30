import { useCallback } from 'react';
import { useRouter } from 'expo-router';

/**
 * Back navigation that always has somewhere to go.
 *
 * A screen is not always reached by being pushed onto a stack. Open the app on
 * a link, reload it during development, or come in from a notification, and the
 * screen you land on is the *first* one — there is nothing behind it. Plain
 * `router.back()` then does nothing at all and React Navigation logs "GO_BACK
 * was not handled by any navigator", leaving the user pressing a back button
 * that visibly does not work.
 *
 * Every back affordance in the app goes through here: pop if there is something
 * to pop, otherwise go home.
 *
 * Home, rather than a guessed parent screen. It is tempting to send the
 * exercise detail back to the library and a plan back to the plans list, but
 * with no history the app does not actually know where the user came from, and
 * inventing an origin is a worse answer than the one place that is always
 * correct. One rule, everywhere, is also one rule for the user to learn.
 */
export function useGoBack(fallback: string = '/') {
  const router = useRouter();

  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback as never);
  }, [router, fallback]);
}

/**
 * Leaves any stack of modals and returns to Today.
 *
 * `dismissAll` throws the same unhandled-action warning when there is nothing
 * stacked to dismiss, which is exactly the case when a program screen was
 * opened directly from a link.
 */
export function useGoHome() {
  const router = useRouter();

  return useCallback(() => {
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
  }, [router]);
}
