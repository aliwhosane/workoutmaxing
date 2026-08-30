import { useMemo, useState } from 'react';
import { View, StyleSheet, FlatList, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGoBack } from '../../src/navigation';
import { Text, Touch, Rule } from '../../src/design/primitives';
import { ExerciseLoop } from '../../src/design/ExerciseLoop';
import { palette, space, radius, type, touch } from '../../src/design/tokens';
import { searchExercises, label, type Exercise } from '../../src/data/catalog';
import { addExerciseToWorkout } from '../../src/db/queries';
import { setPendingDay } from '../../src/store/draftProgram';

/**
 * Add an exercise to a session already in progress. Search-first: mid-workout
 * you already know what you want, so the field is focused on arrival and one
 * tap on a result puts it in the session and returns you to it.
 */
export default function PickExerciseScreen() {
  const { workoutId, forDay } = useLocalSearchParams<{ workoutId?: string; forDay?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useGoBack();
  const [query, setQuery] = useState('');

  const results = useMemo(() => searchExercises(query, 40), [query]);

  // The same picker serves two callers: a live session, which gets the
  // exercise written straight into it, and the plan builder, which is holding
  // an unsaved draft and so takes the choice back through the draft store.
  const pick = async (ex: Exercise) => {
    if (forDay) setPendingDay(`done:${forDay}:${ex.id}`);
    else if (workoutId) await addExerciseToWorkout(workoutId, ex.id);
    goBack();
  };

  return (
    <View style={styles.screen}>
      <View style={{ paddingTop: insets.top + space.sm }}>
        <View style={styles.head}>
          <Text variant="heading">Add exercise</Text>
          <Touch onPress={goBack} style={styles.cancel} haptic="light">
            <Text variant="label" color={palette.ink45}>Cancel</Text>
          </Touch>
        </View>
        <View style={styles.search}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={palette.ink25}
            style={styles.input}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <Rule inset={space.screen + 44 + space.md} />}
        contentContainerStyle={{ paddingTop: space.md, paddingBottom: insets.bottom + space.xl }}
        renderItem={({ item, index }) => (
          <Touch style={styles.row} onPress={() => pick(item)} scaleTo={0.985}>
            <ExerciseLoop frames={item.frames} size={44} paused={index > 8} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyMed" numberOfLines={1}>{item.name}</Text>
              <Text variant="caption" color={palette.ink45} numberOfLines={1}>
                {item.primary.map(label).join(' · ')}
              </Text>
            </View>
          </Touch>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.void },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.screen, paddingBottom: space.md,
  },
  cancel: { height: touch.min, justifyContent: 'center', paddingLeft: space.md },
  search: {
    marginHorizontal: space.screen, paddingHorizontal: space.md,
    height: touch.comfortable - 8, backgroundColor: palette.surface,
    borderRadius: radius.md, justifyContent: 'center',
  },
  input: { color: palette.ink, ...type.body, padding: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.screen, height: 68,
  },
});
