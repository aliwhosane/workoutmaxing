import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import Svg, { Path, Circle } from 'react-native-svg';
import { Text, Touch, Button, Spacer } from '../../src/design/primitives';
import { ExerciseLoop } from '../../src/design/ExerciseLoop';
import { palette, space, radius, touch } from '../../src/design/tokens';
import { getExercise } from '../../src/data/catalog';
import {
  getActiveEnrollment, getProgram, daysForWeek, listSlots, getOpenWorkout,
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
    const days = p ? await daysForWeek(p.id, enrollment.current_week) : [];
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
          {/* Settings is the only thing on this screen that isn't training.
              It sits out of the way, at the top, and never competes with the
              primary action at the bottom. */}
          <Touch
            style={styles.settings}
            onPress={() => router.push('/settings')}
            haptic="light"
            scaleTo={0.9}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24">
              <Circle cx={12} cy={12} r={3.2} stroke={palette.ink45} strokeWidth={1.9} fill="none" />
              <Path
                d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4M17.9 17.9l-1.4-1.4M7.5 7.5L6.1 6.1"
                stroke={palette.ink45} strokeWidth={1.9} strokeLinecap="round" fill="none"
              />
            </Svg>
          </Touch>
          <Text variant="micro" color={palette.ink45}>
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}
          </Text>
          <Spacer h={space.sm} />
          {/* The hero shrinks as the name grows. Program authors write day
              names of wildly different lengths ("Push" vs "Day 2 — OHP /
              Deadlift"), and a fixed 56pt hero turns the long ones into a
              three-line wall that pushes the actual session off screen. */}
          <Text variant={titleVariant(day?.name)} numberOfLines={2}>
            {day ? day.name : 'Rest'}
          </Text>
          {program && (
            <>
              <Spacer h={space.xs} />
              <Text variant="label" color={palette.ink45}>
                {program.name}
                {day?.week != null ? `  ·  Week ${day.week}` : ''}
              </Text>
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

/** Picks the largest size the name fits in without wrapping past two lines. */
function titleVariant(name?: string): 'hero' | 'display' | 'title' {
  const len = name?.length ?? 0;
  if (len <= 12) return 'hero';
  if (len <= 24) return 'display';
  return 'title';
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
  settings: {
    position: 'absolute', right: space.screen - space.sm, top: -space.sm,
    width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center',
  },
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
