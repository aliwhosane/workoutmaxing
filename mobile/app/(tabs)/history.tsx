import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Text, Spacer, Rule } from '../../src/design/primitives';
import { palette, space } from '../../src/design/tokens';
import { listHistory, type HistoryEntry } from '../../src/db/queries';
import { useSettings } from '../../src/settings/store';
import { formatVolume } from '../../src/settings/units';

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { weightUnit } = useSettings();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useFocusEffect(useCallback(() => { listHistory().then(setEntries); }, []));

  const totalVolume = entries.reduce((n, e) => n + e.volume_kg, 0);
  const thisWeek = entries.filter((e) => e.started_at > Date.now() - 7 * 864e5).length;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + 90 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.head}><Text variant="title">History</Text></View>
      <Spacer h={space.xl} />

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="body" color={palette.ink45} center>
            Your first session will show up here.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.stats}>
            <Stat value={String(thisWeek)} label="This week" />
            <Stat value={String(entries.length)} label="Sessions" />
            <Stat value={formatVolume(totalVolume, weightUnit)} label={`Volume ${weightUnit}`} />
          </View>

          <Spacer h={space.xl} />

          {entries.map((e, i) => (
            <View key={e.id}>
              {i > 0 && <Rule inset={space.screen} />}
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyMed" numberOfLines={1}>{e.name}</Text>
                  <Text variant="caption" color={palette.ink45}>
                    {new Date(e.started_at).toLocaleDateString(undefined, {
                      weekday: 'short', month: 'short', day: 'numeric',
                    })}
                    {'  ·  '}{e.set_count} {e.set_count === 1 ? 'set' : 'sets'}
                    {e.finished_at ? `  ·  ${Math.round((e.finished_at - e.started_at) / 60000)} min` : ''}
                  </Text>
                </View>
                <Text variant="label" color={palette.ink70} numeric>
                  {e.volume_kg > 0 ? `${formatVolume(e.volume_kg, weightUnit)} ${weightUnit}` : ''}
                </Text>
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const Stat = ({ value, label }: { value: string; label: string }) => (
  <View style={{ flex: 1, gap: 2 }}>
    <Text variant="display" numeric>{value}</Text>
    <Text variant="micro" color={palette.ink45}>{label.toUpperCase()}</Text>
  </View>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.void },
  head: { paddingHorizontal: space.screen },
  stats: { flexDirection: 'row', paddingHorizontal: space.screen, gap: space.lg },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.screen, paddingVertical: space.lg, gap: space.md,
  },
  empty: { paddingTop: space.huge, paddingHorizontal: space.xxl },
});
