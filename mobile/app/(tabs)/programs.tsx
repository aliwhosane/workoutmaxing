import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Text, Touch, Spacer } from '../../src/design/primitives';
import { palette, space, radius } from '../../src/design/tokens';
import { listPrograms, getActiveEnrollment, type ProgramRow } from '../../src/db/queries';

export default function ProgramsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    (async () => {
      const [list, enrollment] = await Promise.all([listPrograms(), getActiveEnrollment()]);
      setPrograms(list);
      setActiveId(enrollment?.program_id ?? null);
    })();
  }, []));

  const mine = programs.filter((p) => p.origin !== 'builtin');
  const built = programs.filter((p) => p.origin === 'builtin');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + 90 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.head}>
        <Text variant="title">Plans</Text>
      </View>

      <Spacer h={space.lg} />

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

      <SectionLabel>Proven plans</SectionLabel>
      {built.map((p) => (
        <ProgramCard key={p.id} program={p} active={p.id === activeId}
          onPress={() => router.push(`/program/${p.id}`)} />
      ))}
    </ScrollView>
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
  head: { paddingHorizontal: space.screen },
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
