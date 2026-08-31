import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { openDatabase } from '../src/db/client';
import { seedBuiltInPrograms } from '../src/data/programs';
import { loadSettings } from '../src/settings/store';
import { restoreSession } from '../src/auth/store';
import { syncInBackground } from '../src/sync/service';
import { palette, motion } from '../src/design/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    /**
     * Never hold the splash on anything that can be slow.
     *
     * Nothing in here touches the network — sync is deliberately not awaited —
     * but a migration on a large database, or a filesystem under pressure, can
     * still take longer than a person is willing to stare at a logo. After a
     * few seconds the app shows itself regardless; screens open the database
     * on demand, so an early paint costs at most a moment of empty state.
     */
    const watchdog = setTimeout(() => {
      setReady(true);
      SplashScreen.hideAsync().catch(() => {});
    }, 4000);

    (async () => {
      try {
        await openDatabase();
        // Settings before programs: every screen that renders a number reads
        // them synchronously, so they must be hydrated before the first paint
        // or weights would flash in the wrong unit.
        await loadSettings();
        await seedBuiltInPrograms();
        // Session restore is not on the critical path to first paint — the app
        // is fully usable signed out, so we don't make anyone wait on it.
        restoreSession().then(syncInBackground);
      } catch (err) {
        // A failed migration must not trap the user on a splash screen forever.
        console.error('[boot] initialisation failed', err);
      } finally {
        clearTimeout(watchdog);
        setReady(true);
        await SplashScreen.hideAsync().catch(() => {});
      }
    })();

    return () => clearTimeout(watchdog);
  }, []);

  if (!ready) return <View style={{ flex: 1, backgroundColor: palette.void }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.void }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.void },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="exercise/[id]" options={{ presentation: 'card' }} />
          <Stack.Screen name="settings" options={{ presentation: 'card' }} />
          {/* A past session, opened from history. A card, unlike the logger
              below it, which takes over the screen while you are training. */}
          <Stack.Screen name="workout/[id]" options={{ presentation: 'card' }} />
          {/* The logger is a full-screen takeover: while you are training,
              there is nothing else in the app. */}
          <Stack.Screen
            name="workout/active"
            options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }}
          />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
