import { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, TextInput, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { Text, Touch, Button, Spacer, Rule } from '../../src/design/primitives';
import { ExerciseLoop } from '../../src/design/ExerciseLoop';
import { palette, space, radius, type as typo, touch } from '../../src/design/tokens';
import { getExercise } from '../../src/data/catalog';
import { useGoBack } from '../../src/navigation';
import { useSettings } from '../../src/settings/store';
import { displayToKg, weightFieldValue, weightUnchanged } from '../../src/settings/units';
import {
  getWorkout, listSets, updateSetValues, deleteSet, deleteWorkout,
  type SetRow, type WorkoutRow,
} from '../../src/db/queries';

/**
 * A finished session, opened from history.
 *
 * Records are worth keeping accurate, and until now a session was frozen the
 * moment it ended: a weight typed wrong stayed wrong forever, and a workout
 * started just to see how the app behaves could never be tidied away. Both are
 * ordinary things to want, and neither is dangerous as long as the destructive
 * ones are confirmed.
 */
export default function PastWorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useGoBack();
  const { weightUnit } = useSettings();

  const [workout, setWorkout] = useState<WorkoutRow | null>(null);
  const [sets, setSets] = useState<SetRow[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    const [w, s] = await Promise.all([getWorkout(id), listSets(id)]);
    setWorkout(w ?? null);
    setSets(s);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const groups = useMemo(() => {
    const out: { exerciseId: string; sets: SetRow[] }[] = [];
    for (const s of sets) {
      const last = out[out.length - 1];
      if (last && last.exerciseId === s.exercise_id) last.sets.push(s);
      else out.push({ exerciseId: s.exercise_id, sets: [s] });
    }
    return out;
  }, [sets]);

  const volumeKg = sets.reduce(
    (n, s) => n + (s.kind === 'warmup' ? 0 : (s.weight_kg ?? 0) * (s.reps ?? 0)), 0);

  const removeSet = (row: SetRow) => {
    Alert.alert('Delete this set?', 'It will be removed from this session.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => { await deleteSet(row.id); await load(); },
      },
    ]);
  };

  const removeWorkout = () => {
    Alert.alert(
      `Delete ${workout?.name ?? 'this session'}?`,
      'The whole session goes, on this phone and on your other devices. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => { await deleteWorkout(id!); goBack(); },
        },
      ],
    );
  };

  if (!workout) return <View style={styles.screen} />;

  const minutes = workout.finished_at
    ? Math.round((workout.finished_at - workout.started_at) / 60000) : null;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Touch onPress={goBack} style={styles.back} haptic="light">
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path d="M15 5l-7 7 7 7" stroke={palette.ink} strokeWidth={2.2}
              strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        </Touch>

        <View style={styles.head}>
          <Text variant="title">{workout.name}</Text>
          <Spacer h={space.xs} />
          <Text variant="caption" color={palette.ink45}>
            {new Date(workout.started_at).toLocaleDateString(undefined, {
              weekday: 'long', month: 'long', day: 'numeric',
            })}
            {minutes != null ? `  ·  ${minutes} min` : ''}
            {`  ·  ${sets.length} ${sets.length === 1 ? 'set' : 'sets'}`}
          </Text>
        </View>

        <Spacer h={space.xl} />

        {groups.map((g) => {
          const ex = getExercise(g.exerciseId);
          const isDuration = ex?.tracking === 'duration';
          const showsWeight = ex?.tracking === 'weight_reps';
          return (
            <View key={g.exerciseId} style={{ marginBottom: space.xl }}>
              <View style={styles.exerciseHead}>
                {ex && <ExerciseLoop frames={ex.frames} size={40} paused />}
                <Text variant="bodyMed" numberOfLines={1} style={{ flex: 1 }}>
                  {ex?.name ?? g.exerciseId}
                </Text>
              </View>
              {g.sets.map((row, i) => (
                <View key={row.id}>
                  {i > 0 && <Rule inset={space.screen} />}
                  <EditableSet
                    row={row}
                    index={i}
                    showsWeight={showsWeight}
                    isDuration={isDuration}
                    weightUnit={weightUnit}
                    onRemove={() => removeSet(row)}
                    onSave={async (v) => { await updateSetValues(row.id, v); await load(); }}
                  />
                </View>
              ))}
            </View>
          );
        })}

        {sets.length === 0 && (
          <Text variant="body" color={palette.ink45} center style={{ paddingHorizontal: space.xxl }}>
            Every set in this session has been deleted.
          </Text>
        )}
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + space.md }]}>
        <Text variant="caption" color={palette.ink45} center style={{ paddingBottom: space.sm }} numeric>
          {volumeKg > 0 ? `${Math.round(volumeKg * (weightUnit === 'kg' ? 1 : 2.2046226218487757))} ${weightUnit} total` : ' '}
        </Text>
        <Button title="Delete this session" tone="quiet" onPress={removeWorkout} />
      </View>
    </View>
  );
}

/**
 * A set whose numbers can be corrected in place.
 *
 * Edits commit on blur rather than behind a save button: there is no partial
 * state worth protecting, and a screen full of fields with one shared Save is
 * a screen where people lose changes by pressing back.
 */
function EditableSet({
  row, index, showsWeight, isDuration, weightUnit, onSave, onRemove,
}: {
  row: SetRow;
  index: number;
  showsWeight: boolean;
  isDuration: boolean;
  weightUnit: 'kg' | 'lb';
  onSave: (v: { weightKg: number | null; reps: number | null; durationS: number | null }) => void;
  onRemove: () => void;
}) {
  const [weight, setWeight] = useState(weightFieldValue(row.weight_kg, weightUnit));
  const [reps, setReps] = useState(
    isDuration
      ? row.duration_s != null ? String(row.duration_s) : ''
      : row.reps != null ? String(row.reps) : '',
  );

  const commit = () => {
    const parsed = reps ? Number(reps) : null;
    onSave({
      // An untouched field keeps its exact stored value. Converting the shown
      // number back would write the rounded version and move the weight.
      weightKg: weightUnchanged(weight, row.weight_kg, weightUnit)
        ? row.weight_kg
        : weight ? displayToKg(Number(weight), weightUnit) : null,
      reps: isDuration ? null : parsed,
      durationS: isDuration ? parsed : null,
    });
  };

  return (
    <View style={styles.setRow}>
      <Text variant="label" color={palette.ink45} style={{ width: 24 }} numeric>{index + 1}</Text>

      {showsWeight && (
        <TextInput
          value={weight}
          onChangeText={(t) => setWeight(t.replace(/[^0-9.]/g, ''))}
          onBlur={commit}
          keyboardType="decimal-pad"
          selectTextOnFocus
          style={styles.field}
          placeholder="—"
          placeholderTextColor={palette.ink25}
        />
      )}
      <TextInput
        value={reps}
        onChangeText={(t) => setReps(t.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        keyboardType="number-pad"
        selectTextOnFocus
        style={styles.field}
        placeholder="—"
        placeholderTextColor={palette.ink25}
      />
      <Text variant="caption" color={palette.ink25} style={{ width: 42 }}>
        {isDuration ? 'sec' : showsWeight ? weightUnit : 'reps'}
      </Text>

      <Touch onPress={onRemove} style={styles.remove} haptic="medium" scaleTo={0.9}>
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path d="M6 6l12 12M18 6L6 18" stroke={palette.ink45} strokeWidth={2}
            strokeLinecap="round" fill="none" />
        </Svg>
      </Touch>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.void },
  back: {
    marginLeft: space.screen, width: touch.min, height: touch.min,
    alignItems: 'center', justifyContent: 'center',
  },
  head: { paddingHorizontal: space.screen, paddingTop: space.md },
  exerciseHead: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.screen, paddingBottom: space.sm,
  },
  setRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.screen, paddingVertical: space.xs,
  },
  field: {
    flex: 1, textAlign: 'center', color: palette.ink, ...typo.heading,
    fontVariant: ['tabular-nums'], paddingVertical: space.sm,
  },
  remove: {
    width: touch.min, height: touch.min, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  dock: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: space.screen, paddingTop: space.md,
    backgroundColor: palette.void,
  },
});
