import { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import Svg, { Path, Circle } from 'react-native-svg';
import { Text, Touch, Button, Spacer } from '../../src/design/primitives';
import { Surface, liquidGlassAvailable } from '../../src/design/Surface';
import { ExerciseLoop } from '../../src/design/ExerciseLoop';
import { palette, space, radius, touch } from '../../src/design/tokens';
import { getExercise } from '../../src/data/catalog';
import {
  getActiveEnrollment, getProgram, daysForWeek, listSlots, getOpenWorkout,
  startWorkout, type SlotRow, type ProgramRow, type DayRow, type WorkoutRow,
} from '../../src/db/queries';

/** Eight-tooth cog, generated geometrically: tips at r=9.3, roots at r=7.4. */
const GEAR_PATH =
  'M19.08 9.84L21.19 10.55A9.3 9.3 0 0 1 21.19 13.45L19.08 14.16A7.4 7.4 0 0 1 18.53 15.47L19.52 17.47A9.3 9.3 0 0 1 17.47 19.52L15.47 18.53A7.4 7.4 0 0 1 14.16 19.08L13.45 21.19A9.3 9.3 0 0 1 10.55 21.19L9.84 19.08A7.4 7.4 0 0 1 8.53 18.53L6.53 19.52A9.3 9.3 0 0 1 4.48 17.47L5.47 15.47A7.4 7.4 0 0 1 4.92 14.16L2.81 13.45A9.3 9.3 0 0 1 2.81 10.55L4.92 9.84A7.4 7.4 0 0 1 5.47 8.53L4.48 6.53A9.3 9.3 0 0 1 6.53 4.48L8.53 5.47A7.4 7.4 0 0 1 9.84 4.92L10.55 2.81A9.3 9.3 0 0 1 13.45 2.81L14.16 4.92A7.4 7.4 0 0 1 15.47 5.47L17.47 4.48A9.3 9.3 0 0 1 19.52 6.53L18.53 8.53A7.4 7.4 0 0 1 19.08 9.84Z';

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
            // Forgiveness beyond the box itself, for a control at the very edge
            // of the screen where thumbs land imprecisely.
            hitSlop={{ top: space.sm, bottom: space.sm, left: space.md, right: space.md }}
          >
            <Svg width={22} height={22} viewBox="0 0 24 24">
              {/* A cog, not a sun. The teeth are joined to a ring whose root
                  sits just under the tip — detached rays off a small disc is
                  precisely how a sun is drawn, which is what this was. */}
              <Path
                d={GEAR_PATH}
                stroke={palette.ink45}
                strokeWidth={1.6}
                strokeLinejoin="round"
                fill="none"
              />
              <Circle cx={12} cy={12} r={3.1} stroke={palette.ink45} strokeWidth={1.6} fill="none" />
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
      <Surface
        variant="chrome"
        style={[styles.dock, { paddingBottom: insets.bottom + space.md }]}
      >
        <Button
          title={open ? 'Resume workout' : slots.length ? 'Start' : 'Start empty workout'}
          onPress={begin}
        />
      </Surface>
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
    position: 'absolute',
    right: space.screen - space.md,
    /**
     * Zero, not a negative offset. Android does not deliver touches that fall
     * outside a parent's bounds — iOS quietly does — so hanging the control
     * above its container silently killed the top of an already-small target.
     *
     * The box is `comfortable` rather than `min`: 44 is Apple's floor, Android
     * asks for 48, and this is a corner control people reach for one-handed.
     * The icon is pinned toward the top of that box so it sits where it always
     * did while the tappable area grows downward, inside the parent.
     */
    top: 0,
    width: touch.comfortable,
    height: touch.comfortable,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: space.xs,
  },
  list: { paddingHorizontal: space.screen, gap: space.lg },
  slot: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dock: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.screen, paddingTop: space.md,
  },
  empty: { paddingHorizontal: space.xxl, paddingTop: space.huge, alignItems: 'center' },
  textAction: { height: touch.min, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: radius.pill },
});
