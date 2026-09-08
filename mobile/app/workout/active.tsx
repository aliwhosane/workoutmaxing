import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, ScrollView, StyleSheet, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useGoBack } from '../../src/navigation';
import { useKeepAwake } from 'expo-keep-awake';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeIn, Layout } from 'react-native-reanimated';
import { Text, Touch, Button, Spacer } from '../../src/design/primitives';
import { ExerciseLoop } from '../../src/design/ExerciseLoop';
import { RestTimer } from '../../src/design/RestTimer';
import { useForegroundInterval } from '../../src/design/useForegroundInterval';
import { RestPicker, TimerGlyph, restLabel } from '../../src/design/RestPicker';
import { Surface } from '../../src/design/Surface';
import { palette, space, radius, type as typo, touch } from '../../src/design/tokens';
import { getExercise } from '../../src/data/catalog';
import { useSettings, getSettings } from '../../src/settings/store';
import { health } from '../../src/health';
import { syncInBackground } from '../../src/sync/service';
import { displayToKg, weightFieldValue, weightUnchanged } from '../../src/settings/units';
import {
  listSets, completeSet, uncompleteSet, finishWorkout, discardWorkout,
  materializeWorkout, addSetToExercise, listSlots, advanceEnrollment,
  getActiveEnrollment, daysForWeek, restPrefs, setRestPref,
  slotRestPrefs, setSlotRest, type SetRow,
} from '../../src/db/queries';
import { getDb } from '../../src/db/client';

/**
 * Built once, at module scope.
 *
 * A layout animation is a description, not an instance — `Layout.springify()`
 * in the JSX allocates a fresh one on every render and hands Reanimated a new
 * object to register. This screen is open for the length of a workout, so that
 * is the difference between four allocations and thousands.
 */
const BLOCK_LAYOUT = Layout.springify();
const ROW_ENTERING = FadeIn.duration(160);

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
  // Leaving the logger lands on Today when there is no stack behind it, which
  // is the case whenever the session was opened straight from a link.
  const leave = useGoBack();
  const { workoutId } = useLocalSearchParams<{ workoutId: string }>();
  // The fallback rest, for a movement the lifter has never set one on and a
  // program that never prescribed one.
  const { defaultRestSeconds } = useSettings();

  const [sets, setSets] = useState<SetRow[]>([]);
  const [startedAt, setStartedAt] = useState<number>(Date.now());
  const [name, setName] = useState('Workout');
  const [rest, setRest] = useState<{ seconds: number; key: number } | null>(null);
  const [restBySlot, setRestBySlot] = useState<Map<string, number>>(new Map());
  const [restByExercise, setRestByExercise] = useState<Map<string, number>>(new Map());
  const [restBySlotChoice, setRestBySlotChoice] = useState<Map<string, number>>(new Map());

  /**
   * Which rest length is being chosen, if any. `manual` starts a rest right
   * now; `exercise` sets the one that runs automatically after every set of a
   * movement, and is remembered for good.
   */
  const [picker, setPicker] = useState<
    null | { kind: 'manual' } | { kind: 'exercise'; exerciseId: string; slotId: string | null }
  >(null);

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
      // doesn't need a query to know how long to rest. Slots that prescribe
      // nothing are left out entirely, so they fall through to the setting
      // rather than pinning every one of them to the same hardcoded number.
      if (w.day_id) {
        const slots = await listSlots(w.day_id);
        setRestBySlot(new Map(
          slots.flatMap((s) => (s.rest_seconds == null ? [] : [[s.id, s.rest_seconds] as const])),
        ));
      }

      // The lifter's own rest lengths, which outrank whatever the program says.
      setRestByExercise(await restPrefs());
      setRestBySlotChoice(await slotRestPrefs());
      await reload();
    })();
  }, [workoutId, reload]);

  /**
   * Refetch whenever this screen comes back to the front — the exercise picker
   * writes straight to the database and pops, so without this the session would
   * still be showing the set list from before the user added anything.
   *
   * Skipped on the very first focus, where the setup effect above is already
   * mid-flight and would otherwise race it to an empty result.
   */
  /**
   * Set once the session is discarded. Dismissing a modal from inside an Alert
   * callback is not instantaneous, so without this the screen stays live long
   * enough for the user to log another set and finish — which is exactly how a
   * workout ended up both discarded and finished, and vanished from history.
   */
  const discarded = useRef(false);

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

  /**
   * How long to rest after a set of this movement, most specific answer first.
   *
   *   1. what the lifter chose for this exact slot
   *   2. what they chose for the movement anywhere
   *   3. what the program prescribes here
   *   4. the app default
   *
   * Slot beats exercise because a program can prescribe the same lift twice in
   * one session and mean something different each time — 5/3/1 presses heavy
   * for a top set, then again for volume. Zero is a real answer, not a missing
   * one: it means automatic rest was turned off.
   */
  const restFor = useCallback((exerciseId: string, slotId: string | null): number => {
    const chosenHere = slotId ? restBySlotChoice.get(slotId) : undefined;
    if (chosenHere !== undefined) return chosenHere;
    const own = restByExercise.get(exerciseId);
    if (own !== undefined) return own;
    const prescribed = slotId ? restBySlot.get(slotId) : undefined;
    return prescribed ?? defaultRestSeconds;
  }, [restBySlotChoice, restByExercise, restBySlot, defaultRestSeconds]);

  const onComplete = useCallback(async (row: SetRow, values: { weight: number | null; reps: number | null }) => {
    if (discarded.current) return;
    if (row.completed_at) {
      await uncompleteSet(row.id);
      setRest(null);
    } else {
      await completeSet(row.id, { weightKg: values.weight, reps: values.reps });
      const seconds = restFor(row.exercise_id, row.slot_id);
      // Still one tap per set: the rest starts itself. Unless it was switched
      // off for this movement, in which case nothing appears at all.
      if (seconds > 0) setRest({ seconds, key: Date.now() });
    }
    await reload();
  }, [reload, restFor]);

  /**
   * A rest length was chosen. Starting one by hand is a one-off; setting a
   * block's is written through to the database, because it should still be
   * true next week and on the lifter's other phone.
   *
   * It is stored against the slot when the block came from a program, so the
   * other block of the same lift keeps its own; only a block with no slot
   * behind it — an exercise added mid-session — sets the movement's own
   * default.
   */
  const onPickRest = useCallback(async (seconds: number) => {
    if (!picker) return;
    setPicker(null);
    if (picker.kind === 'manual') {
      setRest({ seconds, key: Date.now() });
      return;
    }
    if (picker.slotId) {
      const slotId = picker.slotId;
      await setSlotRest(slotId, seconds);
      setRestBySlotChoice((m) => new Map(m).set(slotId, seconds));
      return;
    }
    await setRestPref(picker.exerciseId, seconds);
    setRestByExercise((m) => new Map(m).set(picker.exerciseId, seconds));
  }, [picker]);

  /**
   * Both of these take the block's own values as arguments rather than closing
   * over them, so there is one stable function for every block instead of a
   * new one per block per render — which is what lets `ExerciseBlock` skip a
   * render it does not need.
   */
  const onEditRest = useCallback((exerciseId: string, slotId: string | null) => {
    setPicker({ kind: 'exercise', exerciseId, slotId });
  }, []);

  const onAddSet = useCallback(async (exerciseId: string) => {
    await addSetToExercise(workoutId!, exerciseId);
    await reload();
  }, [workoutId, reload]);

  const onFinish = () => {
    if (discarded.current) return;
    if (done === 0) {
      Alert.alert('Nothing logged', 'Discard this session?', [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'Discard', style: 'destructive',
          onPress: async () => {
            discarded.current = true;
            await discardWorkout(workoutId!);
            leave();
          },
        },
      ]);
      return;
    }
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    Alert.alert(`Finish ${name}?`, `${done} sets logged in ${mmss(elapsed)}.`, [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Finish',
        onPress: async () => {
          await finishWorkout(workoutId!);

          const enrollment = await getActiveEnrollment();
          if (enrollment) {
            // The current week's day count, so a three-week wave rolls to the
            // next week after three sessions rather than after nine.
            const days = await daysForWeek(enrollment.program_id, enrollment.current_week);
            await advanceEnrollment(enrollment.id, days.length);
          }

          // Leave immediately. Mirroring to the health store and syncing to the
          // server are both things the user should never wait on — the session
          // is already safe in SQLite by this point.
          leave();

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
          <SessionClock startedAt={startedAt} done={done} total={sets.length} />
        </View>
        {/* Rest on demand. Not every rest follows a set — you rest after a
            warm-up, between supersets, or because the rack is busy. */}
        <Touch
          onPress={() => setPicker({ kind: 'manual' })}
          style={styles.headerIcon}
          haptic="light"
          hitSlop={space.sm}
        >
          <TimerGlyph size={22} color={palette.ink70} />
        </Touch>
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
            slotId={g.slotId}
            sets={g.sets}
            note={g.note}
            restSeconds={restFor(g.exerciseId, g.slotId)}
            onEditRest={onEditRest}
            onComplete={onComplete}
            onAddSet={onAddSet}
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

      <Surface variant="chrome" style={[styles.dock, { paddingBottom: insets.bottom + space.sm }]}>
        {rest ? (
          <RestTimer key={rest.key} seconds={rest.seconds} onSkip={() => setRest(null)} />
        ) : (
          <Button
            title="Add exercise"
            tone="quiet"
            onPress={() => router.push({ pathname: '/exercise/pick', params: { workoutId } })}
          />
        )}
      </Surface>

      {picker && (
        <RestPicker
          title={picker.kind === 'manual' ? 'Rest' : 'Rest between sets'}
          subtitle={
            picker.kind === 'manual'
              ? 'Starts now.'
              : 'Runs automatically after every set of this exercise.'
          }
          value={
            picker.kind === 'exercise'
              ? restFor(picker.exerciseId, picker.slotId)
              : null
          }
          allowOff={picker.kind === 'exercise'}
          onPick={onPickRest}
          onClose={() => setPicker(null)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

/* --------------------------------------------------------- session clock */

/**
 * The running time, kept here rather than on the screen itself.
 *
 * It changes once a second, and state that changes once a second re-renders
 * everything below whatever holds it. Held at the top of the logger, that was
 * every exercise block and every set row — and every `Touch` inside them,
 * each of which re-registers an animated style when it renders. Owning the
 * clock here means a tick costs exactly this one line of text.
 */
function SessionClock({ startedAt, done, total }: {
  startedAt: number; done: number; total: number;
}) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt) / 1000));

  // The real start time arrives from SQLite a moment after mount, and the
  // interval is not restarted for it, so the jump to the true elapsed time
  // happens here rather than up to a second later on the next tick.
  useEffect(() => {
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
  }, [startedAt]);

  useForegroundInterval(1000, useCallback(() => {
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
  }, [startedAt]));

  return (
    <Text variant="caption" color={palette.ink45} numeric>
      {mmss(elapsed)}  ·  {done}/{total} sets
    </Text>
  );
}

/* -------------------------------------------------------- exercise block */

/**
 * Memoised, and given callbacks that take their subject as an argument rather
 * than closing over it, so a block only re-renders when its own sets, note or
 * rest length actually change.
 */
const ExerciseBlock = memo(function ExerciseBlock({
  exerciseId, slotId, sets, note, restSeconds, onEditRest, onComplete, onAddSet,
}: {
  exerciseId: string;
  slotId: string | null;
  sets: SetRow[];
  note: string | null;
  /** Rest that runs itself after each of this exercise's sets; 0 = none. */
  restSeconds: number;
  onEditRest: (exerciseId: string, slotId: string | null) => void;
  onComplete: (row: SetRow, v: { weight: number | null; reps: number | null }) => void;
  onAddSet: (exerciseId: string) => void;
}) {
  const ex = getExercise(exerciseId);
  const router = useRouter();
  const { weightUnit } = useSettings();
  if (!ex) return null;

  const isDuration = ex.tracking === 'duration';
  const showsWeight = ex.tracking === 'weight_reps';

  return (
    <Animated.View style={styles.block} layout={BLOCK_LAYOUT}>
      {/* Two targets, side by side rather than nested — a press inside a press
          is ambiguous on Android, and both of these have to be reliable. */}
      <View style={styles.blockHead}>
        <Touch
          style={styles.blockHeadMain}
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

        {/* This exercise's automatic rest, showing its own current value —
            reading it takes no taps, and changing it takes two. */}
        <Touch
          style={styles.restBtn}
          onPress={() => onEditRest(ex.id, slotId)}
          haptic="light"
          scaleTo={0.94}
        >
          <TimerGlyph size={15} color={restSeconds > 0 ? palette.ink45 : palette.ink25} />
          <Text
            variant="caption"
            color={restSeconds > 0 ? palette.ink70 : palette.ink25}
            numeric
          >
            {restSeconds > 0 ? restLabel(restSeconds) : 'Off'}
          </Text>
        </Touch>
      </View>

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

      <Touch onPress={() => onAddSet(ex.id)} style={styles.addSet} haptic="light">
        <Text variant="caption" color={palette.ink45}>+ Set</Text>
      </Touch>
    </Animated.View>
  );
});

/* ------------------------------------------------------------- a set row */

const SetRowView = memo(function SetRowView({
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
    /* The fade is on a wrapper rather than on the row itself, because a
       completed row dims via `opacity` and an entering animation drives the
       same property — Reanimated warns about exactly this, and the two were
       quietly competing for the opacity of any row that mounts already done. */
    <Animated.View entering={ROW_ENTERING}>
      <View style={[styles.setRow, complete && styles.setRowDone]}>
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
              // Same rule as editing history: a prefilled weight the lifter did
              // not touch is stored exactly as it was suggested.
              weight: weightUnchanged(weight, row.weight_kg, weightUnit)
                ? row.weight_kg
                : weight ? displayToKg(Number(weight), weightUnit) : null,
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
      </View>
    </Animated.View>
  );
});

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
  headerIcon: {
    width: touch.min, height: touch.min,
    alignItems: 'center', justifyContent: 'center',
  },
  block: { paddingTop: space.xl },
  blockHead: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.screen, paddingBottom: space.md,
  },
  blockHeadMain: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md,
  },
  restBtn: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    height: touch.min, paddingHorizontal: space.md,
    borderRadius: radius.sm, backgroundColor: palette.ink06,
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
  },
  empty: { paddingTop: space.huge, paddingHorizontal: space.xxl },
});
