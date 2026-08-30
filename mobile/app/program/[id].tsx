import { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGoBack, useGoHome } from '../../src/navigation';
import Svg, { Path } from 'react-native-svg';
import { Text, Touch, Button, Spacer, Rule } from '../../src/design/primitives';
import { Surface } from '../../src/design/Surface';
import { palette, space, radius, touch } from '../../src/design/tokens';
import { getExercise } from '../../src/data/catalog';
import {
  getProgram, listDays, listSlots, enroll, getActiveEnrollment,
  stopFollowingProgram, getEnrollmentFor,
  type ProgramRow, type DayRow, type SlotRow,
} from '../../src/db/queries';

export default function ProgramDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useGoBack();
  const goHome = useGoHome();

  const [program, setProgram] = useState<ProgramRow | null>(null);
  const [days, setDays] = useState<{ day: DayRow; slots: SlotRow[] }[]>([]);
  const [active, setActive] = useState(false);
  /** Where this plan was left off, so a paused plan can say what it will resume to. */
  const [position, setPosition] = useState<{ week: number; day: number } | null>(null);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const p = await getProgram(id);
      setProgram(p ?? null);
      const dayRows = await listDays(id);
      setDays(await Promise.all(
        dayRows.map(async (day) => ({ day, slots: await listSlots(day.id) })),
      ));
      const [activeEnrollment, mine] = await Promise.all([
        getActiveEnrollment(), getEnrollmentFor(id),
      ]);
      setActive(activeEnrollment?.program_id === id);
      setPosition(mine ? { week: mine.current_week, day: mine.current_day } : null);
    })();
  }, [id]);

  if (!program) return <View style={styles.screen} />;

  const start = async () => {
    const current = await getActiveEnrollment();
    const resuming = position != null && (position.week > 1 || position.day > 0);

    const begin = async () => { await enroll(program.id); goHome(); };

    // Switching plans is worth a moment's pause — the one you are on stops,
    // even though nothing about it is lost.
    if (current && current.program_id !== program.id) {
      const outgoing = await getProgram(current.program_id);
      Alert.alert(
        `Switch to ${program.name}?`,
        `You'll stop following ${outgoing?.name ?? 'your current plan'}. Your history stays, and it will pick up where you left off if you come back to it.`,
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Switch', onPress: begin }],
      );
      return;
    }
    if (resuming) {
      Alert.alert(
        `Pick up where you left off?`,
        `You were on week ${position!.week}, day ${position!.day + 1}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Resume', onPress: begin },
        ],
      );
      return;
    }
    await begin();
  };

  const stop = () => {
    Alert.alert(
      `Stop following ${program.name}?`,
      'Nothing is deleted. Your history stays, and starting it again picks up at the same week and day.',
      [
        { text: 'Keep following', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: async () => { await stopFollowingProgram(); goHome(); },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <Touch onPress={goBack} style={styles.back} haptic="light">
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

      <Surface variant="chrome" style={[styles.dock, { paddingBottom: insets.bottom + space.md }]}>
        {active ? (
          <>
            {position && (
              <Text variant="caption" color={palette.ink45} center style={{ paddingBottom: space.md }}>
                Week {position.week}, day {position.day + 1}
              </Text>
            )}
            <Button title="Stop following this plan" tone="quiet" onPress={stop} />
          </>
        ) : (
          <Button
            title={position && (position.week > 1 || position.day > 0)
              ? 'Resume this plan'
              : 'Make this my plan'}
            onPress={start}
          />
        )}
      </Surface>
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
  },
});
