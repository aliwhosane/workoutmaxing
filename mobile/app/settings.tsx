import { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert, Switch, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useGoBack } from '../src/navigation';
import Svg, { Path } from 'react-native-svg';
import { Text, Touch, Spacer, Rule } from '../src/design/primitives';
import { palette, space, radius, touch } from '../src/design/tokens';
import { useSettings, updateSettings } from '../src/settings/store';
import type { DistanceUnit, WeightUnit } from '../src/settings/units';
import { useAuth, signOut } from '../src/auth/store';
import { deleteAccount } from '../src/auth/deleteAccount';
import {
  isAppleAvailable, isGoogleAvailable, signInWithApple, signInWithGoogle, isCancellation,
} from '../src/auth/signIn';
import { useSyncState, syncNow } from '../src/sync/service';
import { health, healthStoreName } from '../src/health';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useGoBack();
  const settings = useSettings();
  const auth = useAuth();
  const syncState = useSyncState();

  const [appleReady, setAppleReady] = useState(false);
  const [healthReady, setHealthReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    isAppleAvailable().then(setAppleReady);
    health.isAvailable().then(setHealthReady);
  }, []);

  const signIn = useCallback(async (provider: 'apple' | 'google') => {
    setBusy(true);
    try {
      if (provider === 'apple') await signInWithApple();
      else await signInWithGoogle();
      await syncNow();
    } catch (err) {
      // Backing out of the system sheet is not an error worth a dialog.
      if (!isCancellation(err)) {
        Alert.alert("Couldn't sign in", (err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Two confirmations, because this is irreversible and the first tap is often
   * a misread. The copy states plainly what survives — local history — so the
   * decision is about syncing rather than about losing a training log.
   */
  const confirmDelete = useCallback(() => {
    Alert.alert(
      'Delete your account?',
      'This erases everything stored on our server for you. Your workout history stays on this phone — delete the app if you want that gone too.\n\nThis cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => Alert.alert(
            'Really delete?',
            'Your account and everything synced to it will be permanently removed.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete account',
                style: 'destructive',
                onPress: async () => {
                  setBusy(true);
                  try {
                    await deleteAccount();
                  } catch (err) {
                    Alert.alert('Not deleted', (err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                },
              },
            ],
          ),
        },
      ],
    );
  }, []);

  const toggleHealth = useCallback(async (next: boolean) => {
    if (!next) { updateSettings({ healthSync: false }); return; }

    const granted = await health.requestPermissions();
    if (granted) { updateSettings({ healthSync: true }); return; }

    Alert.alert(
      `${healthStoreName} access needed`,
      Platform.OS === 'ios'
        ? `Turn on Workout Maxing in Settings → Health → Data Access & Devices.`
        : `Grant Workout Maxing permission in the Health Connect app.`,
    );
  }, []);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <Touch onPress={goBack} style={styles.back} haptic="light">
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path d="M15 5l-7 7 7 7" stroke={palette.ink} strokeWidth={2.2}
              strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        </Touch>
        <Text variant="heading">Settings</Text>
        <View style={{ width: touch.min }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + space.huge }}
        showsVerticalScrollIndicator={false}
      >
        <Section label="Units">
          <Segmented<WeightUnit>
            label="Weight"
            value={settings.weightUnit}
            options={[{ value: 'kg', label: 'Kilograms' }, { value: 'lb', label: 'Pounds' }]}
            onChange={(weightUnit) => updateSettings({ weightUnit })}
          />
          <Rule inset={space.screen} />
          <Segmented<DistanceUnit>
            label="Distance"
            value={settings.distanceUnit}
            options={[{ value: 'km', label: 'Kilometres' }, { value: 'mi', label: 'Miles' }]}
            onChange={(distanceUnit) => updateSettings({ distanceUnit })}
          />
          <Note>
            Changing units only changes what you read. Every set you have ever
            logged is stored the same way underneath, so nothing is converted
            and nothing is lost.
          </Note>
        </Section>

        <Section label="Sync">
          {auth.status === 'signedIn' ? (
            <>
              <Row
                title="Signed in"
                detail={
                  syncState.status === 'syncing' ? 'Syncing…'
                  : syncState.status === 'error' ? 'Will retry — your data is safe on this phone'
                  : syncState.pending ? 'Changes waiting to upload'
                  : syncState.lastSyncedAt ? `Last synced ${timeAgo(syncState.lastSyncedAt)}`
                  : 'Up to date'
                }
              />
              <Rule inset={space.screen} />
              <Action title="Sync now" onPress={() => syncNow()} />
              <Rule inset={space.screen} />
              <Action
                title="Sign out"
                tone="quiet"
                onPress={() =>
                  Alert.alert(
                    'Sign out?',
                    'Your workouts stay on this phone. You just stop syncing to your other devices.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
                    ],
                  )
                }
              />
              <Rule inset={space.screen} />
              <Action title="Delete account" tone="danger" disabled={busy} onPress={confirmDelete} />
            </>
          ) : (
            <>
              <Note>
                Everything works without an account. Sign in only if you want the
                same history on another phone.
              </Note>
              {appleReady && (
                <Action title="Continue with Apple" disabled={busy}
                  onPress={() => signIn('apple')} />
              )}
              {isGoogleAvailable() && (
                <>
                  {appleReady && <Rule inset={space.screen} />}
                  <Action title="Continue with Google" disabled={busy}
                    onPress={() => signIn('google')} />
                </>
              )}
              {!appleReady && !isGoogleAvailable() && (
                <Note>
                  Sign-in isn't available in this build. It needs a development
                  build rather than Expo Go, plus Google credentials in .env.
                </Note>
              )}
            </>
          )}
        </Section>

        <Section label={healthStoreName}>
          {healthReady ? (
            <ToggleRow
              title={`Save workouts to ${healthStoreName}`}
              detail="Finished sessions appear alongside your other activity."
              value={settings.healthSync}
              onChange={toggleHealth}
            />
          ) : (
            <Note>
              {healthStoreName} isn't available here. On Android it needs the
              Health Connect app installed; in Expo Go it needs a development build.
            </Note>
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ pieces */

const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <View style={{ marginTop: space.xl }}>
    <Text variant="micro" color={palette.ink45} style={{ paddingHorizontal: space.screen }}>
      {label.toUpperCase()}
    </Text>
    <Spacer h={space.sm} />
    <View style={styles.group}>{children}</View>
  </View>
);

const Note = ({ children }: { children: React.ReactNode }) => (
  <Text variant="caption" color={palette.ink45} style={styles.note}>{children}</Text>
);

function Row({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body">{title}</Text>
        {detail && <Text variant="caption" color={palette.ink45}>{detail}</Text>}
      </View>
    </View>
  );
}

function Action({
  title, onPress, tone = 'normal', disabled,
}: { title: string; onPress: () => void; tone?: 'normal' | 'quiet' | 'danger'; disabled?: boolean }) {
  const colour = disabled ? palette.ink25
    : tone === 'quiet' ? palette.ink45
    : tone === 'danger' ? palette.strain
    : palette.live;
  return (
    <Touch style={styles.row} onPress={onPress} disabled={disabled} haptic="medium" scaleTo={0.99}>
      <Text variant="body" color={colour}>{title}</Text>
    </Touch>
  );
}

function ToggleRow({
  title, detail, value, onChange,
}: { title: string; detail?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2, paddingRight: space.md }}>
        <Text variant="body">{title}</Text>
        {detail && <Text variant="caption" color={palette.ink45}>{detail}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: palette.live, false: palette.ink12 }}
        thumbColor={palette.ink}
        ios_backgroundColor={palette.ink12}
      />
    </View>
  );
}

/** Two or three mutually exclusive choices, shown all at once rather than hidden in a picker. */
function Segmented<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.row}>
      <Text variant="body" style={{ flex: 1 }}>{label}</Text>
      <View style={styles.segment}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Touch
              key={o.value}
              onPress={() => onChange(o.value)}
              haptic="light"
              scaleTo={0.95}
              style={[styles.segmentItem, active && { backgroundColor: palette.ink }]}
            >
              <Text variant="caption" color={active ? palette.void : palette.ink70}>
                {o.label}
              </Text>
            </Touch>
          );
        })}
      </View>
    </View>
  );
}

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.void },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.screen, paddingBottom: space.md,
  },
  back: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  group: { backgroundColor: palette.surface, marginHorizontal: space.screen, borderRadius: radius.lg },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, minHeight: touch.comfortable, paddingVertical: space.md,
  },
  note: { paddingHorizontal: space.lg, paddingVertical: space.md },
  segment: { flexDirection: 'row', gap: space.xs, backgroundColor: palette.surfaceHigh, borderRadius: radius.pill, padding: 3 },
  segmentItem: { paddingHorizontal: space.md, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
