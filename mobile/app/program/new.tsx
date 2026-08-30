import { useEffect } from 'react';
import { View, ScrollView, StyleSheet, TextInput, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useGoBack } from '../../src/navigation';
import { useCallback } from 'react';
import { Text, Touch, Button, Spacer, Rule } from '../../src/design/primitives';
import { palette, space, radius, type as typo, touch } from '../../src/design/tokens';
import { getExercise } from '../../src/data/catalog';
import {
  useDraft, draftActions, saveDraft, setPendingDay, takePendingDay,
  type DraftSlot,
} from '../../src/store/draftProgram';

/**
 * The plan builder.
 *
 * Structured so the first thing on screen is already a valid plan — one day,
 * waiting for exercises. There is no blank canvas and no setup wizard: you add
 * what you want and leave the rest alone.
 */
export default function NewProgramScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useGoBack();
  const draft = useDraft();

  useEffect(() => () => setPendingDay(null), []);

  // Returning from the picker: it stashes the choice, we consume it here.
  useFocusEffect(useCallback(() => {
    const pending = takePendingDay();
    if (pending?.startsWith('done:')) {
      const [, dayKey, exerciseId] = pending.split(':');
      draftActions.addExercise(dayKey, exerciseId);
    }
  }, []));

  const totalSlots = draft.days.reduce((n, d) => n + d.slots.length, 0);

  const save = async () => {
    if (totalSlots === 0) {
      Alert.alert('Add an exercise first', 'A plan needs at least one movement in it.');
      return;
    }
    const id = await saveDraft();
    router.replace(`/program/${id}`);
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <Touch onPress={() => { draftActions.reset(); goBack(); }} style={styles.headBtn}>
          <Text variant="label" color={palette.ink45}>Cancel</Text>
        </Touch>
        <Text variant="label">New plan</Text>
        <Touch onPress={save} style={styles.headBtn} haptic="medium">
          <Text variant="label" color={totalSlots ? palette.live : palette.ink25}>Save</Text>
        </Touch>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + space.huge }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TextInput
          value={draft.name}
          onChangeText={draftActions.setName}
          placeholder="Name your plan"
          placeholderTextColor={palette.ink25}
          style={styles.nameField}
        />

        {draft.days.map((day) => (
          <View key={day.key} style={styles.day}>
            <View style={styles.dayHead}>
              <TextInput
                value={day.name}
                onChangeText={(t) => draftActions.renameDay(day.key, t)}
                style={styles.dayName}
                placeholderTextColor={palette.ink25}
              />
              {draft.days.length > 1 && (
                <Touch onPress={() => draftActions.removeDay(day.key)} style={styles.remove}>
                  <Text variant="caption" color={palette.ink45}>Remove</Text>
                </Touch>
              )}
            </View>

            {day.slots.map((slot, i) => (
              <View key={slot.key}>
                {i > 0 && <Rule inset={space.screen} />}
                <SlotEditor
                  slot={slot}
                  onChange={(patch) => draftActions.updateSlot(day.key, slot.key, patch)}
                  onRemove={() => draftActions.removeSlot(day.key, slot.key)}
                />
              </View>
            ))}

            <Touch
              style={styles.addExercise}
              haptic="light"
              onPress={() => {
                setPendingDay(day.key);
                router.push({ pathname: '/exercise/pick', params: { forDay: day.key } });
              }}
            >
              <Text variant="caption" color={palette.live}>+ Add exercise</Text>
            </Touch>
          </View>
        ))}

        <Spacer h={space.lg} />
        <View style={{ paddingHorizontal: space.screen }}>
          <Button title="Add another day" tone="quiet" onPress={draftActions.addDay} />
        </View>
      </ScrollView>
    </View>
  );
}

function SlotEditor({
  slot, onChange, onRemove,
}: { slot: DraftSlot; onChange: (p: Partial<DraftSlot>) => void; onRemove: () => void }) {
  const ex = getExercise(slot.exerciseId);
  return (
    <View style={styles.slot}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyMed" numberOfLines={1}>{ex?.name ?? slot.exerciseId}</Text>
        <Touch onPress={onRemove} style={{ alignSelf: 'flex-start' }}>
          <Text variant="caption" color={palette.ink25}>Remove</Text>
        </Touch>
      </View>
      <TextInput
        value={String(slot.sets)}
        onChangeText={(t) => onChange({ sets: Number(t.replace(/[^0-9]/g, '')) || 0 })}
        keyboardType="number-pad"
        style={[styles.mini, { width: 44 }]}
      />
      <Text variant="caption" color={palette.ink25}>×</Text>
      <TextInput
        value={slot.reps}
        onChangeText={(t) => onChange({ reps: t })}
        style={[styles.mini, { width: 64 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.void },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.screen, paddingBottom: space.md,
  },
  headBtn: { height: touch.min, justifyContent: 'center', minWidth: 60 },
  nameField: {
    color: palette.ink, ...typo.title,
    paddingHorizontal: space.screen, paddingVertical: space.lg,
  },
  day: { marginTop: space.lg },
  dayHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.screen, paddingBottom: space.sm,
  },
  dayName: { color: palette.ink, ...typo.heading, flex: 1, padding: 0 },
  remove: { height: touch.min, justifyContent: 'center', paddingLeft: space.md },
  slot: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.screen, paddingVertical: space.md,
  },
  mini: {
    color: palette.ink, ...typo.label, textAlign: 'center',
    backgroundColor: palette.surface, borderRadius: radius.sm,
    paddingVertical: space.sm,
  },
  addExercise: {
    marginHorizontal: space.screen, marginTop: space.sm,
    height: touch.min, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.ink06,
  },
});
