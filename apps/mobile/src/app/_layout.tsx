import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';

import { initCrashlytics } from '@/services/crashlytics';
import { sessionStore, useSession, useThemePreference } from '@/stores';
import { INTER, INTER_FONT_MAP } from '@/theme/fonts';
import { AppThemeProvider, useTheme, type Theme as AppTheme } from '@/theme/theme';

void SplashScreen.preventAutoHideAsync();

function navigationTheme({ scheme, colors }: AppTheme): Theme {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
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
}

/**
 * Root: loads Inter, starts the auth session and applies the app gate (LLD §4.2) with protected
 * route groups. The splash screen stays up until fonts and the first auth state are ready.
 */
export default function RootLayout(): React.JSX.Element | null {
  const [fontsLoaded, fontError] = useFonts(INTER_FONT_MAP);
  const gate = useSession((s) => s.gate);
  const preference = useThemePreference();
  const fontsReady = fontsLoaded || fontError !== null;

  useEffect(() => {
    void initCrashlytics();
    return sessionStore.getState().start();
  }, []);

  useEffect(() => {
    if (fontsReady && gate !== 'booting') void SplashScreen.hideAsync();
  }, [fontsReady, gate]);

  if (!fontsReady || gate === 'booting') return null;
  return (
    <AppThemeProvider preference={preference}>
      <RootNavigator signedIn={gate === 'ready' || gate === 'loadingProfile' || gate === 'profileError'} />
    </AppThemeProvider>
  );
}

/** The themed navigator; the gate only flips its guards. */
function RootNavigator({ signedIn }: { readonly signedIn: boolean }): React.JSX.Element {
  const theme = useTheme();
  const { colors } = theme;
  const navTheme = useMemo(() => navigationTheme(theme), [theme]);
  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
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
