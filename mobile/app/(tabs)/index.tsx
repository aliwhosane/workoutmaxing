import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Text, Touch, Button, Spacer } from '../../src/design/primitives';
import { ExerciseLoop } from '../../src/design/ExerciseLoop';
import { palette, space, radius, touch } from '../../src/design/tokens';
import { getExercise } from '../../src/data/catalog';
import {
  getActiveEnrollment, getProgram, listDays, listSlots, getOpenWorkout,
  startWorkout, type SlotRow, type ProgramRow, type DayRow, type WorkoutRow,
} from '../../src/db/queries';

/**
 * Today.
 *
 * The app opens on the single question a lifter actually has when they pick up
 * their phone in a gym: what am I doing right now? Everything else on this
 * screen is subordinate to one button.
 */
export default function TodayScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [program, setProgram] = useState<ProgramRow | null>(null);
  const [day, setDay] = useState<DayRow | null>(null);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [open, setOpen] = useState<WorkoutRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [enrollment, openWorkout] = await Promise.all([
      getActiveEnrollment(), getOpenWorkout(),
    ]);
    setOpen(openWorkout ?? null);

    if (!enrollment) {
      setProgram(null); setDay(null); setSlots([]); setLoading(false);
      return;
    }
    const p = await getProgram(enrollment.program_id);
    const days = p ? await listDays(p.id) : [];
    const today = days[enrollment.current_day % Math.max(days.length, 1)] ?? null;
    setProgram(p ?? null);
    setDay(today);
    setSlots(today ? await listSlots(today.id) : []);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const begin = async () => {
    const id = open?.id ?? await startWorkout({
      name: day?.name ?? 'Workout',
      programId: program?.id ?? null,
      dayId: day?.id ?? null,
    });
    router.push({ pathname: '/workout/active', params: { workoutId: id } });
  };

  if (loading) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.lg,
          paddingBottom: insets.bottom + 140,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.head}>
          <Text variant="micro" color={palette.ink45}>
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}
          </Text>
          <Spacer h={space.sm} />
          <Text variant="hero">{day ? day.name : 'Rest'}</Text>
          {program && (
            <>
              <Spacer h={space.xs} />
              <Text variant="label" color={palette.ink45}>{program.name}</Text>
            </>
          )}
        </View>

        <Spacer h={space.xl} />

        {slots.length > 0 ? (
          <View style={styles.list}>
            {slots.map((slot, i) => <SlotPreview key={slot.id} slot={slot} index={i} />)}
          </View>
        ) : (
          <EmptyState onBrowse={() => router.push('/programs')} />
        )}
      </ScrollView>

      {/* The primary action never scrolls away. There is exactly one of these
          on the screen, and it is always in the same place. */}
      <View style={[styles.dock, { paddingBottom: insets.bottom + space.md }]}>
        <Button
          title={open ? 'Resume workout' : slots.length ? 'Start' : 'Start empty workout'}
          onPress={begin}
        />
      </View>
    </View>
  );
}

function SlotPreview({ slot, index }: { slot: SlotRow; index: number }) {
  const ex = getExercise(slot.exercise_id);
  if (!ex) return null;

  const prescription = [
    slot.target_sets ? `${slot.target_sets}` : null,
    slot.target_reps ? `× ${slot.target_reps}` : null,
  ].filter(Boolean).join(' ');

  return (
    <View style={styles.slot}>
      {/* Only the first few animate — beyond that they're out of sight and
          would just burn battery. */}
      <ExerciseLoop frames={ex.frames} size={52} paused={index > 3} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyMed" numberOfLines={1}>{ex.name}</Text>
        {slot.notes && (
          <Text variant="caption" color={palette.ink45} numberOfLines={1}>{slot.notes}</Text>
        )}
      </View>
      <Text variant="label" color={palette.ink70} numeric>{prescription}</Text>
    </View>
  );
}

function EmptyState({ onBrowse }: { onBrowse: () => void }) {
  return (
    <View style={styles.empty}>
      <Text variant="heading" color={palette.ink70} center>Nothing scheduled</Text>
      <Spacer h={space.sm} />
      <Text variant="body" color={palette.ink45} center>
        Pick a plan and the app will tell you what to lift, every day, without you having to think about it.
      </Text>
      <Spacer h={space.xl} />
      <Touch onPress={onBrowse} style={styles.textAction}>
        <Text variant="bodyMed" color={palette.live}>Browse plans</Text>
      </Touch>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.void },
  head: { paddingHorizontal: space.screen },
  list: { paddingHorizontal: space.screen, gap: space.lg },
  slot: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dock: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.screen, paddingTop: space.md,
    backgroundColor: palette.void,
  },
  empty: { paddingHorizontal: space.xxl, paddingTop: space.huge, alignItems: 'center' },
  textAction: { height: touch.min, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: radius.pill },
});
