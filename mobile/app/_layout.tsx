import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { openDatabase } from '../src/db/client';
import { seedBuiltInPrograms } from '../src/data/programs';
import { palette, motion } from '../src/design/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await openDatabase();
        await seedBuiltInPrograms();
      } catch (err) {
        // A failed migration must not trap the user on a splash screen forever.
        console.error('[boot] initialisation failed', err);
      } finally {
        setReady(true);
        await SplashScreen.hideAsync().catch(() => {});
      }
    })();
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
