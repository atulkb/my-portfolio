import { Tabs } from 'expo-router';

import { colors } from '@/theme/tokens';

/**
 * Bottom tabs (LLD §4.1). Only Portfolio exists so far, so the bar stays hidden; Watchlist,
 * Rules and Research tabs are added with M6–M8.
 */
export default function TabsLayout(): React.JSX.Element {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' },
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen name="portfolio" options={{ title: 'Portfolio' }} />
    </Tabs>
  );
}
