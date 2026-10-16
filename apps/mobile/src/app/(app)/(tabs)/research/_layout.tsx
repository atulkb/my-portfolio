import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

/** Stack inside the Research tab (LLD §4.1): start screen, then one screen per instrument. */
export default function ResearchLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />;
}
