import { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGoBack } from '../../src/navigation';
import Svg, { Path } from 'react-native-svg';
import { Text, Touch, Spacer, Rule } from '../../src/design/primitives';
import { ExerciseLoop } from '../../src/design/ExerciseLoop';
import { palette, space, radius, touch } from '../../src/design/tokens';
import { getExercise, label } from '../../src/data/catalog';
import { lastPerformance, epley, type SetRow } from '../../src/db/queries';
import { useSettings } from '../../src/settings/store';
import { formatWeight } from '../../src/settings/units';

export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useGoBack();
  const { weightUnit } = useSettings();
  const ex = getExercise(id!);

  const [recent, setRecent] = useState<SetRow[]>([]);
  useEffect(() => { if (id) lastPerformance(id).then(setRecent); }, [id]);

  if (!ex) return <View style={styles.screen} />;

  const best = recent.reduce(
    (m, s) => (s.weight_kg && s.reps ? Math.max(m, epley(s.weight_kg, s.reps)) : m), 0,
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        showsVerticalScrollIndicator={false}
      >
        {/* The demonstration leads. You should understand the movement before
            you read a word about it. */}
        <ExerciseLoop
          frames={ex.frames}
          size={0}
          radiusOverride={0}
          style={{ width: '100%', height: 320, borderRadius: 0 }}
        />

        <Touch
          style={[styles.back, { top: insets.top + space.sm }]}
          onPress={goBack}
          haptic="light"
        >
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path d="M15 5l-7 7 7 7" stroke={palette.ink} strokeWidth={2.2}
              strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        </Touch>

        <View style={styles.body}>
          <Text variant="title">{ex.name}</Text>
          <Spacer h={space.sm} />
          <View style={styles.tags}>
            {[label(ex.equipment), ...ex.primary.map(label), ex.level].map((t) => (
              <View key={t} style={styles.tag}>
                <Text variant="caption" color={palette.ink70}>{t}</Text>
              </View>
            ))}
          </View>

          {best > 0 && (
            <>
              <Spacer h={space.xl} />
              <Text variant="micro" color={palette.ink45}>ESTIMATED 1RM</Text>
              <Spacer h={space.xs} />
              <Text variant="display" numeric>
                {formatWeight(best, weightUnit)} {weightUnit}
              </Text>
            </>
          )}

          {recent.length > 0 && (
            <>
              <Spacer h={space.xl} />
              <Text variant="micro" color={palette.ink45}>RECENT SETS</Text>
              <Spacer h={space.sm} />
              {recent.slice(0, 5).map((s) => (
                <View key={s.id} style={styles.recentRow}>
                  <Text variant="body" color={palette.ink70} numeric>
                    {s.weight_kg ? `${formatWeight(s.weight_kg, weightUnit)} ${weightUnit} × ` : ''}
                    {s.reps ?? `${s.duration_s}s`}
                  </Text>
                  <Text variant="caption" color={palette.ink25}>
                    {s.completed_at ? new Date(s.completed_at).toLocaleDateString() : ''}
                  </Text>
                </View>
              ))}
            </>
          )}

          <Spacer h={space.xl} />
          <Rule />
          <Spacer h={space.xl} />

          <Text variant="micro" color={palette.ink45}>HOW TO DO IT</Text>
          <Spacer h={space.md} />
          {ex.instructions.map((line, i) => (
            <View key={i} style={styles.step}>
              <Text variant="caption" color={palette.live} numeric style={{ width: 20 }}>
                {i + 1}
              </Text>
              <Text variant="body" color={palette.ink70} style={{ flex: 1 }}>{line}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.void },
  back: {
    position: 'absolute', left: space.screen,
    width: touch.min, height: touch.min, borderRadius: radius.pill,
    backgroundColor: 'rgba(10,10,11,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  body: { paddingHorizontal: space.screen, paddingTop: space.xl },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tag: {
    paddingHorizontal: space.md, height: 28, borderRadius: radius.pill,
    backgroundColor: palette.surface, justifyContent: 'center',
  },
  recentRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingVertical: space.sm,
  },
  step: { flexDirection: 'row', gap: space.md, marginBottom: space.lg },
});
