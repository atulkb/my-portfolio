import { Stack } from 'expo-router';

import { useTheme } from '@/theme/theme';

/** Stack inside the Research tab (LLD §4.1): start screen, then one screen per instrument. */
export default function ResearchLayout(): React.JSX.Element {
  const { colors } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />;
}
