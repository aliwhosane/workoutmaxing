import { View, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { palette, space, type } from '../../src/design/tokens';

/**
 * Four destinations, never more. Each one is a noun the user already has a
 * word for. The bar floats over content with no top border — separation comes
 * from the blur-dark plate, not a line.
 */
export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.ink,
        tabBarInactiveTintColor: palette.ink25,
        tabBarStyle: [styles.bar, { height: 52 + insets.bottom, paddingBottom: insets.bottom }],
        tabBarLabelStyle: { ...type.micro, textTransform: 'uppercase' },
        tabBarItemStyle: { paddingTop: space.sm },
        sceneStyle: { backgroundColor: palette.void },
      }}
    >
      <Tabs.Screen name="index"    options={{ title: 'Today',   tabBarIcon: (p) => <Icon name="today" {...p} /> }} />
      <Tabs.Screen name="programs" options={{ title: 'Plans',   tabBarIcon: (p) => <Icon name="plans" {...p} /> }} />
      <Tabs.Screen name="library"  options={{ title: 'Library', tabBarIcon: (p) => <Icon name="library" {...p} /> }} />
      <Tabs.Screen name="history"  options={{ title: 'History', tabBarIcon: (p) => <Icon name="history" {...p} /> }} />
    </Tabs>
  );
}

/** Icons are inline SVG so they inherit tint exactly and add no asset weight. */
function Icon({ name, color }: { name: string; color: any }) {
  const common = { stroke: color, strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      {name === 'today' && (
        <>
          <Circle cx={12} cy={12} r={9} {...common} />
          <Path d="M12 7.5v5l3 2" {...common} />
        </>
      )}
      {name === 'plans' && (
        <>
          <Path d="M4 6h16M4 12h16M4 18h10" {...common} />
        </>
      )}
      {name === 'library' && (
        <>
          <Path d="M6.5 9v6M17.5 9v6M3.5 10.5v3M20.5 10.5v3M6.5 12h11" {...common} />
        </>
      )}
      {name === 'history' && (
        <>
          <Path d="M4 19V9M9.33 19V5M14.67 19v-7M20 19v-4" {...common} />
        </>
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: palette.void,
    borderTopWidth: 0,
    elevation: 0,
  },
});
