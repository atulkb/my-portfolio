import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { initCrashlytics } from '@/services/crashlytics';
import { sessionStore, useSession } from '@/stores';
import { INTER, INTER_FONT_MAP } from '@/theme/fonts';
import { colors } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();

const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.gain,
    background: colors.canvas,
    card: colors.surface1,
    text: colors.textPrimary,
    border: colors.border,
    notification: colors.loss,
  },
  fonts: {
    regular: { fontFamily: INTER[400], fontWeight: '400' },
    medium: { fontFamily: INTER[500], fontWeight: '500' },
    bold: { fontFamily: INTER[600], fontWeight: '600' },
    heavy: { fontFamily: INTER[700], fontWeight: '700' },
  },
};

/**
 * Root: loads Inter, starts the auth session and applies the app gate (LLD §4.2) with protected
 * route groups. The splash screen stays up until fonts and the first auth state are ready.
 */
export default function RootLayout(): React.JSX.Element | null {
  const [fontsLoaded, fontError] = useFonts(INTER_FONT_MAP);
  const gate = useSession((s) => s.gate);
  const fontsReady = fontsLoaded || fontError !== null;

  useEffect(() => {
    void initCrashlytics();
    return sessionStore.getState().start();
  }, []);

  useEffect(() => {
    if (fontsReady && gate !== 'booting') void SplashScreen.hideAsync();
  }, [fontsReady, gate]);

  if (!fontsReady || gate === 'booting') return null;
  const signedIn = gate === 'ready' || gate === 'loadingProfile' || gate === 'profileError';

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style="light" />
      {/* The navigator is never swapped out (that froze transitions); the gate only flips guards. */}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
