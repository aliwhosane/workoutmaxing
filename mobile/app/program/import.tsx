import { useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, TextInput, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useGoBack } from '../../src/navigation';
import { Text, Touch, Button, Spacer, Rule } from '../../src/design/primitives';
import { palette, space, radius, type as typo, touch } from '../../src/design/tokens';
import { getExercise } from '../../src/data/catalog';
import { parse, saveImportedProgram } from '../../src/db/programImport';

const PLACEHOLDER = `Day 1 — Upper
Bench Press 4 sets of 6-8
Barbell Row 4x8
Overhead Press 3x10

Day 2 — Lower
Barbell Squat 5x5 @75%
Romanian Deadlift 3 sets of 8-10`;

/**
 * Import a program by pasting it.
 *
 * The app ships only programs whose authors publish them freely. For anything
 * else — a plan from a coach, a book, or a subscription the lifter already pays
 * for — this is the way in, and it has a real advantage over us transcribing
 * it: the numbers come from the source rather than from anyone's reading of it.
 */
export default function ImportProgramScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useGoBack();
  const [text, setText] = useState('');

  /**
   * The plan's identity, kept apart from the paste.
   *
   * Prefilled from whatever the source declared, but only while the field is
   * untouched — once the lifter types their own name, re-parsing a further
   * paste must not overwrite it.
   */
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const edited = useRef({ name: false, author: false, description: false });

  // Parsing is cheap and pure, so the preview updates as the user types rather
  // than hiding behind a button.
  const parsed = useMemo(() => (text.trim() ? parse(text) : null), [text]);

  useEffect(() => {
    if (!parsed) return;
    if (!edited.current.name && parsed.name) setName(parsed.name);
    if (!edited.current.author && parsed.author) setAuthor(parsed.author);
    if (!edited.current.description && parsed.description) setDescription(parsed.description);
  }, [parsed]);

  const matched = parsed?.days.reduce(
    (n, d) => n + d.slots.filter((s) => s.exerciseId).length, 0) ?? 0;
  const total = parsed?.days.reduce((n, d) => n + d.slots.length, 0) ?? 0;

  // A plan with no name is the thing this screen exists to prevent, so it
  // gates the Import button alongside having something to import.
  const ready = matched > 0 && name.trim().length > 0;

  const save = async () => {
    if (!parsed || !ready) return;
    const skipped = total - matched;
    const go = async () => {
      const id = await saveImportedProgram(parsed, { name, author, description });
      router.replace(`/program/${id}`);
    };

    if (skipped > 0) {
      Alert.alert(
        `Import without ${skipped} exercise${skipped === 1 ? '' : 's'}?`,
        `${skipped} line${skipped === 1 ? '' : 's'} didn’t match anything in the library and will be left out. You can add them by hand afterwards.`,
        [{ text: 'Back', style: 'cancel' }, { text: 'Import', onPress: go }],
      );
      return;
    }
    await go();
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <Touch onPress={goBack} style={styles.headBtn}>
          <Text variant="label" color={palette.ink45}>Cancel</Text>
        </Touch>
        <Text variant="label">Import a plan</Text>
        <Touch onPress={save} style={styles.headBtn} haptic="medium" disabled={!ready}>
          <Text variant="label" color={ready ? palette.live : palette.ink25}>Import</Text>
        </Touch>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + space.huge }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text variant="caption" color={palette.ink45} style={styles.blurb}>
          Paste a plan from anywhere — a spreadsheet, a PDF, a forum post, a
          coach’s email. It reads the usual ways people write sets:
          “Squat 5x5”, “3 sets of 8-12”, “@75%”, “RPE 8”. A “Name:”,
          “Author:” or “Description:” line is picked up too — you can edit all
          three below. Anything it can’t place is listed rather than guessed
          at, and whatever you paste stays on this phone.
        </Text>

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={PLACEHOLDER}
          placeholderTextColor={palette.ink25}
          style={styles.input}
          multiline
          autoCorrect={false}
          autoCapitalize="none"
          textAlignVertical="top"
        />

        {parsed && (
          <>
            {/* The plan's identity. It sits above the preview because it is
                what the lifter will see on their shelf afterwards — the days
                below are a check that the paste read correctly, this is the
                part they own. */}
            <View style={styles.details}>
              <Text variant="micro" color={palette.ink45}>THIS PLAN</Text>
              <Spacer h={space.sm} />
              <TextInput
                value={name}
                onChangeText={(t) => { edited.current.name = true; setName(t); }}
                placeholder="Name this plan"
                placeholderTextColor={palette.ink25}
                style={styles.nameField}
                returnKeyType="next"
              />
              <Rule />
              <TextInput
                value={author}
                onChangeText={(t) => { edited.current.author = true; setAuthor(t); }}
                placeholder="Author or coach"
                placeholderTextColor={palette.ink25}
                style={styles.field}
                returnKeyType="next"
              />
              <Rule />
              <TextInput
                value={description}
                onChangeText={(t) => { edited.current.description = true; setDescription(t); }}
                placeholder="What it's for — a line or two"
                placeholderTextColor={palette.ink25}
                style={[styles.field, styles.descriptionField]}
                multiline
                textAlignVertical="top"
              />
            </View>

            <View style={styles.summary}>
              <Text variant="micro" color={palette.ink45}>
                {parsed.days.length} DAY{parsed.days.length === 1 ? '' : 'S'}
                {'   ·   '}{matched}/{total} EXERCISES MATCHED
              </Text>
            </View>

            {parsed.warnings.length > 0 && (
              <View style={styles.warnBox}>
                {parsed.warnings.slice(0, 6).map((w) => (
                  <Text key={w.line} variant="caption" color={palette.strain}>
                    Line {w.line}: {w.reason}
                  </Text>
                ))}
                {parsed.warnings.length > 6 && (
                  <Text variant="caption" color={palette.ink45}>
                    …and {parsed.warnings.length - 6} more
                  </Text>
                )}
              </View>
            )}

            {parsed.days.map((day, di) => (
              <View key={di} style={{ marginTop: space.xl }}>
                <Text variant="micro" color={palette.ink45} style={{ paddingHorizontal: space.screen }}>
                  {(day.week != null ? `WEEK ${day.week} · ` : '') + day.name.toUpperCase()}
                </Text>
                <Spacer h={space.sm} />
                {day.slots.map((slot, si) => {
                  const ex = slot.exerciseId ? getExercise(slot.exerciseId) : null;
                  return (
                    <View key={si}>
                      {si > 0 && <Rule inset={space.screen} />}
                      <View style={styles.row}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text
                            variant="body"
                            color={ex ? palette.ink : palette.strain}
                            numberOfLines={1}
                          >
                            {ex?.name ?? slot.exerciseQuery}
                          </Text>
                          {!ex && (
                            <Text variant="caption" color={palette.ink45}>
                              no match — will be skipped
                            </Text>
                          )}
                          {ex && slot.note && (
                            <Text variant="caption" color={palette.ink45} numberOfLines={1}>
                              {slot.note}
                            </Text>
                          )}
                        </View>
                        <Text variant="label" color={palette.ink70} numeric>
                          {[
                            slot.sets && slot.reps ? `${slot.sets} × ${slot.reps}` : null,
                            slot.pct != null ? `${Math.round(slot.pct * 100)}%` : null,
                            slot.rpe != null ? `RPE ${slot.rpe}` : null,
                          ].filter(Boolean).join('  ')}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        )}
      </ScrollView>
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
  blurb: { paddingHorizontal: space.screen, paddingBottom: space.md },
  input: {
    marginHorizontal: space.screen, padding: space.md,
    minHeight: 180, backgroundColor: palette.surface, borderRadius: radius.md,
    color: palette.ink, ...typo.body,
  },
  details: {
    marginHorizontal: space.screen, marginTop: space.lg,
    padding: space.md, backgroundColor: palette.surface, borderRadius: radius.md,
  },
  nameField: { color: palette.ink, ...typo.heading, paddingVertical: space.sm },
  field: { color: palette.ink, ...typo.body, paddingVertical: space.md },
  descriptionField: { minHeight: 60 },
  summary: { paddingHorizontal: space.screen, paddingTop: space.lg },
  warnBox: {
    marginHorizontal: space.screen, marginTop: space.md, padding: space.md,
    backgroundColor: 'rgba(255,107,90,0.10)', borderRadius: radius.sm, gap: 2,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.screen, paddingVertical: space.md,
  },
});
