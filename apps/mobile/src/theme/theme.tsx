import { createContext, useContext, useEffect } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';

import { nativeColorScheme, type ThemePreference } from '@/stores/themeStore';
import { labelColorsFor, palettes, type ColorScheme, type LabelColors, type Palette } from './tokens';

/** The resolved theme (LLD §4.17). */
export type Theme = {
  readonly scheme: ColorScheme;
  readonly colors: Palette;
  readonly labelColors: LabelColors;
};

const themes: Readonly<Record<ColorScheme, Theme>> = {
  dark: { scheme: 'dark', colors: palettes.dark, labelColors: labelColorsFor(palettes.dark) },
  light: { scheme: 'light', colors: palettes.light, labelColors: labelColorsFor(palettes.light) },
};

/** The scheme to draw with: the forced choice, or the phone's (unknown → dark). */
export function resolveScheme(preference: ThemePreference, system: string | null | undefined): ColorScheme {
  if (preference !== 'system') return preference;
  return system === 'light' ? 'light' : 'dark';
}

const ThemeContext = createContext<Theme>(themes.dark);

/**
 * Applies the appearance preference natively (so alerts, pickers and the keyboard follow it),
 * keeps the root window colour in step and provides the resulting theme. `system` follows the phone; an unknown scheme falls back to dark.
 */
export function AppThemeProvider({
  preference,
  children,
}: {
  readonly preference: ThemePreference;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  useEffect(() => {
    Appearance.setColorScheme(nativeColorScheme(preference));
  }, [preference]);
  const scheme = resolveScheme(preference, useColorScheme());
  useEffect(() => {
    // Root window colour shows behind screen transitions and the keyboard.
    void SystemUI.setBackgroundColorAsync(palettes[scheme].canvas);
  }, [scheme]);
  return <ThemeContext.Provider value={themes[scheme]}>{children}</ThemeContext.Provider>;
}

/** The current theme: scheme, palette and badge colours. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * Builds a `useStyles()` hook from a palette-dependent style factory. Styles are created once
 * per scheme and reused, so components re-render with new colours when the scheme changes.
 */
export function makeStyles<T>(factory: (colors: Palette) => T): () => T {
  const cache = new Map<ColorScheme, T>();
  return function useStyles(): T {
    const { scheme, colors } = useTheme();
    let styles = cache.get(scheme);
    if (styles === undefined) {
      styles = factory(colors);
      cache.set(scheme, styles);
    }
    return styles;
  };
}
