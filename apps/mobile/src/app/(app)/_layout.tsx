import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';

import { ToastHost } from '@/components/ToastHost';
import { startAnalysisSync } from '@/features/analysis/hooks';
import { LoadingProfileScreen, ProfileErrorScreen } from '@/features/auth/GateScreens';
import { hasUnpricedHoldings, hydrateMarket, refreshPortfolio } from '@/features/portfolio/hooks';
import { instrumentStore, portfolioStore, usePortfolio, useSession } from '@/stores';
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
  const loadState = usePortfolio((s) => s.loadState);
  const transactions = usePortfolio((s) => s.transactions);

  // Startup when ready (LLD §4.2): transactions from Firestore; stock list check (≤ 1×/24 h).
  useEffect(() => {
    if (gate !== 'ready') return;
    void portfolioStore.getState().load();
    void instrumentStore.getState().ensureFresh();
  }, [gate]);

  // Indicators + Health follow market data, sector overrides and the stock list (LLD §4.3).
  useEffect(() => (gate === 'ready' ? startAnalysisSync() : undefined), [gate]);

  // Prices: cached first, then the refresh pipeline (cheap when the cache is current, LLD §3.8).
  useEffect(() => {
    if (gate !== 'ready' || loadState !== 'ready') return;
    hydrateMarket();
    void refreshPortfolio(false);
  }, [gate, loadState]);

  // A newly added stock has no price yet: fetch just what is missing.
  useEffect(() => {
    if (loadState === 'ready' && hasUnpricedHoldings()) void refreshPortfolio(false);
  }, [transactions, loadState]);

  // Foreground: a new session may have closed while the app was in the background (LLD §4.2).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && portfolioStore.getState().loadState === 'ready') void refreshPortfolio(false);
    });
    return () => sub.remove();
  }, []);

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
        <Stack.Screen name="sheets/filter" options={sheet()} />
        <Stack.Screen name="sheets/holding-actions" options={sheet('fitToContents')} />
        <Stack.Screen name="sheets/remove-holding" options={sheet('fitToContents')} />
      </Stack>
      <ToastHost />
    </View>
  );
}
