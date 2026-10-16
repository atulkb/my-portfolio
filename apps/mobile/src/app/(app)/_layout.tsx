import { Stack } from 'expo-router';

import { LoadingProfileScreen, ProfileErrorScreen } from '@/features/auth/GateScreens';
import { useSession } from '@/stores';
import { colors } from '@/theme/tokens';

/**
 * Signed-in group. While the profile is being created/loaded (or failed) it shows the matching
 * gate screen instead of the stack. Tabs arrive with M4/M5 (LLD §4.1).
 */
export default function AppLayout(): React.JSX.Element {
  const gate = useSession((s) => s.gate);
  if (gate === 'loadingProfile') return <LoadingProfileScreen />;
  if (gate === 'profileError') return <ProfileErrorScreen />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />;
}
