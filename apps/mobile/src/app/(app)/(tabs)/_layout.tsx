import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

import { colors, typography } from '@/theme/tokens';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function tabIcon(name: IconName) {
  function TabIcon({ color }: { color: ColorValue }): React.JSX.Element {
    return <MaterialCommunityIcons name={name} size={24} color={color} />;
  }
  return TabIcon;
}

/** Bottom tabs (LLD §4.1): Portfolio · Watchlist · Rules · Research. */
export default function TabsLayout(): React.JSX.Element {
  return (
    <Tabs
      // Back returns to the tab the user came from (e.g. Watchlist → Research → back = Watchlist),
      // not always to the first tab.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarActiveTintColor: colors.gain,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: typography.labelSm,
        tabBarStyle: { backgroundColor: colors.surface1, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="portfolio" options={{ title: 'Portfolio', tabBarIcon: tabIcon('chart-donut') }} />
      <Tabs.Screen
        name="watchlist"
        options={{ title: 'Watchlist', tabBarIcon: tabIcon('bookmark-outline') }}
      />
      <Tabs.Screen name="rules" options={{ title: 'Rules', tabBarIcon: tabIcon('tune-variant') }} />
      <Tabs.Screen
        name="research"
        options={{ title: 'Research', tabBarIcon: tabIcon('chart-timeline-variant') }}
      />
    </Tabs>
  );
}
