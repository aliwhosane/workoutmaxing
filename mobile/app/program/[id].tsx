import { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { Text, Touch, Button, Spacer, Rule } from '../../src/design/primitives';
import { palette, space, radius, touch } from '../../src/design/tokens';
import { getExercise } from '../../src/data/catalog';
import {
  getProgram, listDays, listSlots, enroll, getActiveEnrollment,
  type ProgramRow, type DayRow, type SlotRow,
} from '../../src/db/queries';

export default function ProgramDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [program, setProgram] = useState<ProgramRow | null>(null);
  const [days, setDays] = useState<{ day: DayRow; slots: SlotRow[] }[]>([]);
  const [active, setActive] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const p = await getProgram(id);
      setProgram(p ?? null);
      const dayRows = await listDays(id);
      setDays(await Promise.all(
        dayRows.map(async (day) => ({ day, slots: await listSlots(day.id) })),
      ));
      const e = await getActiveEnrollment();
      setActive(e?.program_id === id);
    })();
  }, [id]);

  if (!program) return <View style={styles.screen} />;

  const start = async () => {
    await enroll(program.id);
    router.dismissAll();
    router.replace('/');
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <Touch onPress={() => router.back()} style={styles.back} haptic="light">
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path d="M15 5l-7 7 7 7" stroke={palette.ink} strokeWidth={2.2}
              strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        </Touch>

        <View style={styles.body}>
          <View style={[styles.stripe, { backgroundColor: program.accent ?? palette.ink25 }]} />
          <Spacer h={space.lg} />
          <Text variant="title">{program.name}</Text>
          <Spacer h={space.xs} />
          <Text variant="caption" color={palette.ink45}>
            {[program.author, `${program.days_per_week}×/week`,
              program.weeks ? `${program.weeks} weeks` : 'Ongoing'].filter(Boolean).join('  ·  ')}
          </Text>
          <Spacer h={space.lg} />
          <Text variant="body" color={palette.ink70}>{program.description}</Text>

          <Spacer h={space.xxl} />

          {days.map(({ day, slots }) => (
            <View key={day.id} style={{ marginBottom: space.xl }}>
              <Text variant="micro" color={palette.ink45}>{day.name.toUpperCase()}</Text>
              <Spacer h={space.md} />
              {slots.map((slot, i) => {
                const ex = getExercise(slot.exercise_id);
                return (
                  <View key={slot.id}>
                    {i > 0 && <Rule />}
                    <View style={styles.slotRow}>
                      <Text variant="body" color={palette.ink} style={{ flex: 1 }} numberOfLines={1}>
                        {ex?.name ?? slot.exercise_id}
                      </Text>
                      <Text variant="label" color={palette.ink45} numeric>
                        {slot.target_sets} × {slot.target_reps}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + space.md }]}>
        <Button
          title={active ? 'Already your plan' : 'Make this my plan'}
          disabled={active}
          onPress={start}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.void },
  back: {
    marginLeft: space.screen,
    width: touch.min, height: touch.min, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { paddingHorizontal: space.screen, paddingTop: space.md },
  stripe: { width: 44, height: 3, borderRadius: 2 },
  slotRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md,
  },
  dock: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.screen, paddingTop: space.md,
    backgroundColor: palette.void,
  },
});
