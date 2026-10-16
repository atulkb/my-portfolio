import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

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
 * Root navigator: loads Inter, keeps the splash screen until fonts are ready and applies the
 * Obsidian dark theme. The auth/app gate and tabs are added in M2 (LLD §4.1–4.2).
 */
export default function RootLayout(): React.JSX.Element | null {
  const [fontsLoaded, fontError] = useFonts(INTER_FONT_MAP);
  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />
    </ThemeProvider>
  );
}
