import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

/** Signed-in group. Tabs (Portfolio · Watchlist · Rules · Research) arrive with M4/M5 (LLD §4.1). */
export default function AppLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />;
}
