import { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Text, Touch, Spacer } from '../../src/design/primitives';
import { palette, space, radius, touch } from '../../src/design/tokens';
import { listPrograms, getActiveEnrollment, type ProgramRow } from '../../src/db/queries';

export default function ProgramsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [daysFilter, setDaysFilter] = useState<number | null>(null);

  useFocusEffect(useCallback(() => {
    (async () => {
      const [list, enrollment] = await Promise.all([listPrograms(), getActiveEnrollment()]);
      setPrograms(list);
      setActiveId(enrollment?.program_id ?? null);
    })();
  }, []));

  /**
   * The filter offers only the frequencies that actually exist, derived from
   * the programs themselves — a "5 days" chip that returns nothing is worse
   * than no chip at all.
   */
  const availableDays = useMemo(
    () => [...new Set(programs.map((p) => p.days_per_week).filter((d): d is number => !!d))]
      .sort((a, b) => a - b),
    [programs],
  );

  const visible = useMemo(
    () => (daysFilter == null ? programs : programs.filter((p) => p.days_per_week === daysFilter)),
    [programs, daysFilter],
  );

  const mine = visible.filter((p) => p.origin !== 'builtin');
  const built = visible.filter((p) => p.origin === 'builtin');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + 90 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.head}>
        <Text variant="title">Plans</Text>
        <Text variant="caption" color={palette.ink45} numeric>{visible.length}</Text>
      </View>

      {/* How many days a week you can actually train is the first thing that
          rules a plan in or out, so it filters before anything else. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        <DayChip label="Any" active={daysFilter == null} onPress={() => setDaysFilter(null)} />
        {availableDays.map((d) => (
          <DayChip
            key={d}
            label={`${d} days`}
            active={daysFilter === d}
            onPress={() => setDaysFilter(daysFilter === d ? null : d)}
          />
        ))}
      </ScrollView>

      <Touch
        style={styles.createRow}
        onPress={() => router.push('/program/new')}
        scaleTo={0.98}
      >
        <View style={styles.plus}>
          <Text variant="heading" color={palette.void}>+</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyMed">Build your own</Text>
          <Text variant="caption" color={palette.ink45}>
            Any exercise, any structure, in a few minutes
          </Text>
        </View>
      </Touch>

      {mine.length > 0 && (
        <>
          <SectionLabel>Yours</SectionLabel>
          {mine.map((p) => (
            <ProgramCard key={p.id} program={p} active={p.id === activeId}
              onPress={() => router.push(`/program/${p.id}`)} />
          ))}
        </>
      )}

      {built.length > 0 && <SectionLabel>Proven plans</SectionLabel>}
      {built.map((p) => (
        <ProgramCard key={p.id} program={p} active={p.id === activeId}
          onPress={() => router.push(`/program/${p.id}`)} />
      ))}

      {visible.length === 0 && (
        <View style={{ paddingHorizontal: space.xxl, paddingTop: space.huge }}>
          <Text variant="body" color={palette.ink45} center>
            No plans at that frequency yet. Build your own above.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function DayChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Touch
      onPress={onPress}
      scaleTo={0.94}
      style={[styles.chip, active && { backgroundColor: palette.ink }]}
    >
      <Text variant="caption" color={active ? palette.void : palette.ink70}>{label}</Text>
    </Touch>
  );
}

const SectionLabel = ({ children }: { children: string }) => (
  <View style={{ paddingHorizontal: space.screen, paddingTop: space.xl, paddingBottom: space.md }}>
    <Text variant="micro" color={palette.ink45}>{children.toUpperCase()}</Text>
  </View>
);

export function ProgramCard({ program: p, active, onPress }: {
  program: ProgramRow; active: boolean; onPress: () => void;
}) {
  return (
    <Touch style={styles.card} onPress={onPress} scaleTo={0.98}>
      {/* A single accent stripe carries the plan's identity — cheaper and
          calmer than a cover image, and it never needs to load. */}
      <View style={[styles.stripe, { backgroundColor: p.accent ?? palette.ink25 }]} />
      <View style={{ flex: 1, gap: space.xs }}>
        <View style={styles.cardTop}>
          <Text variant="heading" numberOfLines={1} style={{ flex: 1 }}>{p.name}</Text>
          {active && (
            <View style={styles.badge}>
              <Text variant="micro" color={palette.void}>ACTIVE</Text>
            </View>
          )}
        </View>
        <Text variant="caption" color={palette.ink45}>
          {[p.author, p.days_per_week ? `${p.days_per_week}×/week` : null,
            p.weeks ? `${p.weeks} weeks` : 'Ongoing'].filter(Boolean).join('  ·  ')}
        </Text>
        {p.description && (
          <Text variant="caption" color={palette.ink70} numberOfLines={2} style={{ marginTop: 2 }}>
            {p.description}
          </Text>
        )}
      </View>
    </Touch>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.void },
  head: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingHorizontal: space.screen,
  },
  filterRow: { paddingHorizontal: space.screen, paddingTop: space.lg, gap: space.sm },
  chip: {
    paddingHorizontal: space.md, height: 32, borderRadius: radius.pill,
    backgroundColor: palette.surfaceHigh, alignItems: 'center', justifyContent: 'center',
  },
  createRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    marginHorizontal: space.screen, padding: space.lg,
    backgroundColor: palette.surface, borderRadius: radius.lg,
  },
  plus: {
    width: 40, height: 40, borderRadius: radius.pill,
    backgroundColor: palette.live, alignItems: 'center', justifyContent: 'center',
  },
  card: {
    flexDirection: 'row', gap: space.md,
    marginHorizontal: space.screen, marginBottom: space.md,
    padding: space.lg, backgroundColor: palette.surface, borderRadius: radius.lg,
  },
  stripe: { width: 3, borderRadius: 2, alignSelf: 'stretch' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: {
    backgroundColor: palette.live, paddingHorizontal: space.sm,
    height: 20, borderRadius: radius.pill, justifyContent: 'center',
  },
});
