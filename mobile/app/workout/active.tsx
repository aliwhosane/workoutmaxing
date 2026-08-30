import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, ScrollView, StyleSheet, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeIn, Layout } from 'react-native-reanimated';
import { Text, Touch, Button, Spacer } from '../../src/design/primitives';
import { ExerciseLoop } from '../../src/design/ExerciseLoop';
import { RestTimer } from '../../src/design/RestTimer';
import { palette, space, radius, type as typo, touch } from '../../src/design/tokens';
import { getExercise } from '../../src/data/catalog';
import { useSettings, getSettings } from '../../src/settings/store';
import { health } from '../../src/health';
import { syncInBackground } from '../../src/sync/service';
import { displayToKg, weightFieldValue } from '../../src/settings/units';
import {
  listSets, completeSet, uncompleteSet, finishWorkout, discardWorkout,
  materializeWorkout, addSetToExercise, listSlots, advanceEnrollment,
  getActiveEnrollment, listDays, type SetRow,
} from '../../src/db/queries';
import { getDb } from '../../src/db/client';

/**
 * The logger.
 *
 * Everything here serves one number: taps per set. A set that goes as planned
 * costs exactly one tap on the check — the weight and reps are already filled
 * in from last time, the rest timer starts itself, and the next set is already
 * on screen. Typing is the exception, not the flow.
 */
export default function ActiveWorkoutScreen() {
  useKeepAwake(); // the screen must not sleep between sets

  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { workoutId } = useLocalSearchParams<{ workoutId: string }>();

  const [sets, setSets] = useState<SetRow[]>([]);
  const [startedAt, setStartedAt] = useState<number>(Date.now());
  const [name, setName] = useState('Workout');
  const [elapsed, setElapsed] = useState(0);
  const [rest, setRest] = useState<{ seconds: number; key: number } | null>(null);
  const [restBySlot, setRestBySlot] = useState<Map<string, number>>(new Map());

  const reload = useCallback(async () => {
    if (!workoutId) return;
    setSets(await listSets(workoutId));
  }, [workoutId]);

  useEffect(() => {
    (async () => {
      if (!workoutId) return;
      const w = await (await getDb()).getFirstAsync<{ name: string; started_at: number; day_id: string | null }>(
        'SELECT name, started_at, day_id FROM workout WHERE id = ?', workoutId,
      );
      if (!w) return;
      setName(w.name);
      setStartedAt(w.started_at);

      await materializeWorkout(workoutId, w.day_id);

      // Rest periods are prescribed per slot; cache them so completing a set
      // doesn't need a query to know how long to rest.
      if (w.day_id) {
        const slots = await listSlots(w.day_id);
        setRestBySlot(new Map(slots.map((s) => [s.id, s.rest_seconds ?? 120])));
      }
      await reload();
    })();
  }, [workoutId, reload]);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  /**
   * Refetch whenever this screen comes back to the front — the exercise picker
   * writes straight to the database and pops, so without this the session would
   * still be showing the set list from before the user added anything.
   *
   * Skipped on the very first focus, where the setup effect above is already
   * mid-flight and would otherwise race it to an empty result.
   */
  const setupDone = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (setupDone.current) reload();
      else setupDone.current = true;
    }, [reload]),
  );

  /** Sets arrive flat and ordered; group them into the exercise blocks we render. */
  const groups = useMemo(() => {
    const out: { exerciseId: string; slotId: string | null; sets: SetRow[]; note: string | null }[] = [];
    for (const s of sets) {
      const last = out[out.length - 1];
      if (last && last.exerciseId === s.exercise_id && last.slotId === s.slot_id) last.sets.push(s);
      // The coaching note is written onto the first set of each exercise when
      // the session is built, so it rides along with the group.
      else out.push({ exerciseId: s.exercise_id, slotId: s.slot_id, sets: [s], note: s.coach_note });
    }
    return out;
  }, [sets]);

  const done = sets.filter((s) => s.completed_at).length;

  const onComplete = useCallback(async (row: SetRow, values: { weight: number | null; reps: number | null }) => {
    if (row.completed_at) {
      await uncompleteSet(row.id);
      setRest(null);
    } else {
      await completeSet(row.id, { weightKg: values.weight, reps: values.reps });
      const seconds = (row.slot_id && restBySlot.get(row.slot_id)) || 120;
      setRest({ seconds, key: Date.now() });
    }
    await reload();
  }, [reload, restBySlot]);

  const onFinish = () => {
    if (done === 0) {
      Alert.alert('Nothing logged', 'Discard this session?', [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'Discard', style: 'destructive',
          onPress: async () => { await discardWorkout(workoutId!); router.back(); },
        },
      ]);
      return;
    }
    Alert.alert(`Finish ${name}?`, `${done} sets logged in ${mmss(elapsed)}.`, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Finish',
        onPress: async () => {
          await finishWorkout(workoutId!);

          const enrollment = await getActiveEnrollment();
          if (enrollment) {
            const days = await listDays(enrollment.program_id);
            await advanceEnrollment(enrollment.id, days.length);
          }

          // Leave immediately. Mirroring to the health store and syncing to the
          // server are both things the user should never wait on — the session
          // is already safe in SQLite by this point.
          router.back();

          if (getSettings().healthSync) {
            health
              .saveWorkout({
                id: workoutId!,
                name,
                startedAt: new Date(startedAt),
                finishedAt: new Date(),
              })
              .catch(() => {});
          }
          syncInBackground();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <View style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={1}>{name}</Text>
          <Text variant="caption" color={palette.ink45} numeric>
            {mmss(elapsed)}  ·  {done}/{sets.length} sets
          </Text>
        </View>
        <Touch onPress={onFinish} style={styles.finish} haptic="medium">
          <Text variant="label" color={palette.live}>Finish</Text>
        </Touch>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 130 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {groups.map((g) => (
          <ExerciseBlock
            key={`${g.exerciseId}-${g.slotId}`}
            exerciseId={g.exerciseId}
            sets={g.sets}
            note={g.note}
            onComplete={onComplete}
            onAddSet={async () => { await addSetToExercise(workoutId!, g.exerciseId); await reload(); }}
          />
        ))}

        {groups.length === 0 && (
          <View style={styles.empty}>
            <Text variant="body" color={palette.ink45} center>
              An empty session. Add the first exercise below.
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + space.sm }]}>
        {rest ? (
          <RestTimer key={rest.key} seconds={rest.seconds} onSkip={() => setRest(null)} />
        ) : (
          <Button
            title="Add exercise"
            tone="quiet"
            onPress={() => router.push({ pathname: '/exercise/pick', params: { workoutId } })}
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

/* -------------------------------------------------------- exercise block */

function ExerciseBlock({
  exerciseId, sets, note, onComplete, onAddSet,
}: {
  exerciseId: string;
  sets: SetRow[];
  note: string | null;
  onComplete: (row: SetRow, v: { weight: number | null; reps: number | null }) => void;
  onAddSet: () => void;
}) {
  const ex = getExercise(exerciseId);
  const router = useRouter();
  const { weightUnit } = useSettings();
  if (!ex) return null;

  const isDuration = ex.tracking === 'duration';
  const showsWeight = ex.tracking === 'weight_reps';

  return (
    <Animated.View style={styles.block} layout={Layout.springify()}>
      <Touch
        style={styles.blockHead}
        onPress={() => router.push(`/exercise/${ex.id}`)}
        scaleTo={0.99}
      >
        <ExerciseLoop frames={ex.frames} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyMed" numberOfLines={1}>{ex.name}</Text>
          <Text variant="caption" color={palette.ink45}>
            {ex.primary.join(' · ')}
          </Text>
        </View>
      </Touch>

      {/* Why this weight. The lifter should always be able to see the
          reasoning and disagree with it — the number is a suggestion, not an
          instruction, and every field stays editable. */}
      {note && (
        <View style={styles.coachNote}>
          <Text variant="caption" color={palette.live}>{note}</Text>
        </View>
      )}

      <View style={styles.columns}>
        <Text variant="micro" color={palette.ink25} style={{ width: 28 }}>SET</Text>
        {showsWeight && (
          <Text variant="micro" color={palette.ink25} style={styles.colNum}>
            {weightUnit.toUpperCase()}
          </Text>
        )}
        <Text variant="micro" color={palette.ink25} style={styles.colNum}>
          {isDuration ? 'SEC' : 'REPS'}
        </Text>
        <View style={{ width: touch.comfortable }} />
      </View>

      {sets.map((s, i) => (
        <SetRowView
          key={s.id}
          row={s}
          index={i}
          showsWeight={showsWeight}
          isDuration={isDuration}
          onComplete={onComplete}
        />
      ))}

      <Touch onPress={onAddSet} style={styles.addSet} haptic="light">
        <Text variant="caption" color={palette.ink45}>+ Set</Text>
      </Touch>
    </Animated.View>
  );
}

/* ------------------------------------------------------------- a set row */

function SetRowView({
  row, index, showsWeight, isDuration, onComplete,
}: {
  row: SetRow; index: number; showsWeight: boolean; isDuration: boolean;
  onComplete: (row: SetRow, v: { weight: number | null; reps: number | null }) => void;
}) {
  const { weightUnit } = useSettings();

  /**
   * Local copies so typing stays instant and never waits on SQLite. These hold
   * the number the user sees, in their chosen unit; the conversion back to
   * canonical kilograms happens on the way into the database, never in it.
   */
  const [weight, setWeight] = useState(weightFieldValue(row.weight_kg, weightUnit));
  const [reps, setReps] = useState(
    isDuration
      ? row.duration_s != null ? String(row.duration_s) : ''
      : row.reps != null ? String(row.reps) : '',
  );

  useEffect(() => {
    setWeight(weightFieldValue(row.weight_kg, weightUnit));
    setReps(isDuration
      ? row.duration_s != null ? String(row.duration_s) : ''
      : row.reps != null ? String(row.reps) : '');
  }, [row.weight_kg, row.reps, row.duration_s, isDuration, weightUnit]);

  const complete = !!row.completed_at;

  return (
    <Animated.View entering={FadeIn.duration(160)} style={[styles.setRow, complete && styles.setRowDone]}>
      <Text variant="label" color={complete ? palette.ink45 : palette.ink70} style={{ width: 28 }} numeric>
        {index + 1}
      </Text>

      {showsWeight && (
        <NumberField value={weight} onChange={setWeight} dimmed={complete} />
      )}
      <NumberField value={reps} onChange={setReps} dimmed={complete} integer />

      {/* The one tap that matters. Large, unmissable, and always in the same
          spot so it can be hit without looking. */}
      <Touch
        style={[styles.check, complete && styles.checkDone]}
        haptic={complete ? 'light' : 'success'}
        scaleTo={0.88}
        onPress={() =>
          onComplete(row, {
            weight: weight ? displayToKg(Number(weight), weightUnit) : null,
            reps: reps ? Number(reps) : null,
          })
        }
      >
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke={complete ? palette.liveInk : palette.ink25}
            strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none"
          />
        </Svg>
      </Touch>
    </Animated.View>
  );
}

/** A number, not a text box. No border, no background — just the figure. */
function NumberField({
  value, onChange, dimmed, integer,
}: { value: string; onChange: (s: string) => void; dimmed: boolean; integer?: boolean }) {
  return (
    <TextInput
      value={value}
      onChangeText={(t) => onChange(t.replace(integer ? /[^0-9]/g : /[^0-9.]/g, ''))}
      keyboardType={integer ? 'number-pad' : 'decimal-pad'}
      placeholder="—"
      placeholderTextColor={palette.ink25}
      selectTextOnFocus
      style={[styles.numField, { color: dimmed ? palette.ink45 : palette.ink }]}
    />
  );
}

const mmss = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.void },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.screen, paddingBottom: space.md,
  },
  finish: { height: touch.min, paddingHorizontal: space.md, justifyContent: 'center' },
  block: { paddingTop: space.xl },
  blockHead: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.screen, paddingBottom: space.md,
  },
  coachNote: {
    marginHorizontal: space.screen, marginBottom: space.md,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    backgroundColor: 'rgba(214,255,63,0.10)', borderRadius: radius.sm,
  },
  columns: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.screen, paddingBottom: space.xs,
  },
  colNum: { flex: 1, textAlign: 'center' },
  setRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.screen, paddingVertical: space.xs,
  },
  setRowDone: { opacity: 0.75 },
  numField: {
    flex: 1, textAlign: 'center', ...typo.heading,
    fontVariant: ['tabular-nums'], paddingVertical: space.sm,
  },
  check: {
    width: touch.comfortable, height: touch.comfortable - 8,
    borderRadius: radius.md, backgroundColor: palette.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  checkDone: { backgroundColor: palette.live },
  addSet: {
    marginHorizontal: space.screen, marginTop: space.sm,
    height: touch.min, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.ink06,
  },
  dock: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.screen, paddingTop: space.sm,
    backgroundColor: palette.void,
  },
  empty: { paddingTop: space.huge, paddingHorizontal: space.xxl },
});
