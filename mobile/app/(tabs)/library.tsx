import { useMemo, useState, useCallback } from 'react';
import {
  View, StyleSheet, FlatList, TextInput, ScrollView, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path, Circle } from 'react-native-svg';
import { Text, Touch, Rule } from '../../src/design/primitives';
import { ExerciseLoop } from '../../src/design/ExerciseLoop';
import { palette, space, radius, type, touch } from '../../src/design/tokens';
import {
  filterExercises, MUSCLES, EQUIPMENT, label, type Exercise,
} from '../../src/data/catalog';

const ROW_HEIGHT = 76;

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);

  const results = useMemo(
    () => filterExercises({ query, muscle, equipment }),
    [query, muscle, equipment],
  );

  const renderItem = useCallback(
    ({ item }: { item: Exercise }) => (
      <ExerciseRow exercise={item} onPress={() => router.push(`/exercise/${item.id}`)} />
    ),
    [router],
  );

  // Fixed row height lets the list skip measurement entirely — the difference
  // between a library that scrolls at 120fps and one that stutters.
  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index }),
    [],
  );

  return (
    <View style={styles.screen}>
      <View style={{ paddingTop: insets.top + space.sm }}>
        <View style={styles.header}>
          <Text variant="title">Library</Text>
          <Text variant="caption" color={palette.ink45} numeric>
            {results.length}
          </Text>
        </View>

        <SearchField value={query} onChange={setQuery} />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          keyboardShouldPersistTaps="handled"
        >
          <Chip
            label="All"
            active={!muscle && !equipment}
            onPress={() => { setMuscle(null); setEquipment(null); }}
          />
          {MUSCLES.map((m) => (
            <Chip
              key={m}
              label={label(m)}
              active={muscle === m}
              onPress={() => setMuscle(muscle === m ? null : m)}
            />
          ))}
          {EQUIPMENT.map((e) => (
            <Chip
              key={e}
              label={label(e)}
              active={equipment === e}
              onPress={() => setEquipment(equipment === e ? null : e)}
            />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={results}
        keyExtractor={(e) => e.id}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        ItemSeparatorComponent={() => <Rule inset={space.screen + 56 + space.md} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
        initialNumToRender={12}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="body" color={palette.ink45} center>
              Nothing matches that.
            </Text>
          </View>
        }
      />
    </View>
  );
}

function ExerciseRow({ exercise, onPress }: { exercise: Exercise; onPress: () => void }) {
  return (
    <Touch style={styles.row} onPress={onPress} scaleTo={0.985} haptic="light">
      <ExerciseLoop frames={exercise.frames} size={56} />
      <View style={styles.rowText}>
        <Text variant="bodyMed" numberOfLines={1}>{exercise.name}</Text>
        <Text variant="caption" color={palette.ink45} numberOfLines={1}>
          {exercise.primary.map(label).join(' · ')}
          {exercise.equipment !== 'other' ? `  ·  ${label(exercise.equipment)}` : ''}
        </Text>
      </View>
    </Touch>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <View style={styles.search}>
      <Svg width={18} height={18} viewBox="0 0 24 24" style={{ marginRight: space.sm }}>
        <Circle cx={11} cy={11} r={7} stroke={palette.ink45} strokeWidth={2} fill="none" />
        <Path d="M16.5 16.5L21 21" stroke={palette.ink45} strokeWidth={2} strokeLinecap="round" />
      </Svg>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search 873 exercises"
        placeholderTextColor={palette.ink25}
        style={styles.searchInput}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
    </View>
  );
}

export function Chip({ label: text, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Touch
      onPress={onPress}
      scaleTo={0.94}
      style={[styles.chip, active && { backgroundColor: palette.ink }]}
    >
      <Text variant="caption" color={active ? palette.void : palette.ink70}>{text}</Text>
    </Touch>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.void },
  header: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingHorizontal: space.screen, paddingBottom: space.md,
  },
  search: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: space.screen, paddingHorizontal: space.md,
    height: touch.comfortable - 8,
    backgroundColor: palette.surface, borderRadius: radius.md,
  },
  searchInput: { flex: 1, color: palette.ink, ...type.body, padding: 0 },
  chipRow: { paddingHorizontal: space.screen, paddingVertical: space.md, gap: space.sm },
  chip: {
    paddingHorizontal: space.md, height: 32, borderRadius: radius.pill,
    backgroundColor: palette.surfaceHigh, alignItems: 'center', justifyContent: 'center',
  },
  row: {
    height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.screen, gap: space.md,
  },
  rowText: { flex: 1, gap: 2 },
  empty: { paddingTop: space.huge },
});
