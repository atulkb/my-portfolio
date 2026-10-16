import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { ToastHost } from '@/components/ToastHost';
import { LoadingProfileScreen, ProfileErrorScreen } from '@/features/auth/GateScreens';
import { instrumentStore, portfolioStore, useSession } from '@/stores';
import { colors, radii } from '@/theme/tokens';

/** Native sheet presentation for `sheets/*` routes (LLD §4.1). */
function sheet(detents: number[] | 'fitToContents' = [0.92]) {
  return {
    presentation: 'formSheet' as const,
    sheetAllowedDetents: detents,
    sheetGrabberVisible: true,
    sheetCornerRadius: radii.xl,
    contentStyle: { backgroundColor: colors.canvas },
  };
}

/**
 * Signed-in group: tabs, pushed screens and sheets. While the profile is being created/loaded
 * (or failed) it shows the matching gate screen instead.
 */
export default function AppLayout(): React.JSX.Element {
  const gate = useSession((s) => s.gate);

  // Startup when ready (LLD §4.2): transactions from Firestore; stock list check (≤ 1×/24 h).
  useEffect(() => {
    if (gate !== 'ready') return;
    void portfolioStore.getState().load();
    void instrumentStore.getState().ensureFresh();
  }, [gate]);

  if (gate === 'loadingProfile') return <LoadingProfileScreen />;
  if (gate === 'profileError') return <ProfileErrorScreen />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="holding/[key]/edit" />
        <Stack.Screen name="sheets/add-buy" options={sheet()} />
        <Stack.Screen name="sheets/csv-result" options={sheet()} />
        <Stack.Screen name="sheets/holding-actions" options={sheet('fitToContents')} />
        <Stack.Screen name="sheets/remove-holding" options={sheet('fitToContents')} />
      </Stack>
      <ToastHost />
    </View>
  );
}
