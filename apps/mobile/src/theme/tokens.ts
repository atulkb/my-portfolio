/**
 * Design tokens for the "Obsidian Capital" design system
 * (docs/ui/screens/obsidian_capital/DESIGN.md), with dark and light palettes (LLD §4.17).
 * Components read colours through `useTheme()` / `makeStyles()` (theme/theme.tsx); no colour or
 * spacing literals elsewhere.
 */
import type { TextStyle } from 'react-native';
import { INTER } from './fonts';

/** Colour roles. Status colours are never the only cue: text labels always accompany them. */
export type Palette = {
  readonly canvas: string;
  readonly surface1: string;
  readonly surface2: string;
  readonly border: string;
  readonly scrim: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  /** Gain / bullish, primary actions. */
  readonly gain: string;
  readonly gainPressed: string;
  readonly gainTint: string;
  readonly onGain: string;
  /** Loss / bearish. */
  readonly loss: string;
  readonly lossTint: string;
  readonly destructiveBorder: string;
  /** Average / hold / warnings. */
  readonly caution: string;
  readonly cautionTint: string;
  /** Neutral accent: focus rings, info. */
  readonly info: string;
  /** Not rated / insufficient data. */
  readonly unrated: string;
};

/** Resolved colour scheme. */
export type ColorScheme = 'light' | 'dark';

/**
 * Palettes per scheme (LLD §4.17). Dark is the Obsidian design; light is derived from it with
 * status colours darkened to WCAG AA (≥ 4.5 : 1) on canvas and both surfaces.
 */
export const palettes: Readonly<Record<ColorScheme, Palette>> = {
  dark: {
    canvas: '#0D0F12',
    surface1: '#14171D',
    surface2: '#1A1E26',
    border: '#262B35',
    scrim: 'rgba(13, 15, 18, 0.85)',
    textPrimary: '#F3F4F6',
    textSecondary: '#9CA3AF',
    textMuted: '#4B5563',
    gain: '#05DF72',
    gainPressed: '#10B981',
    gainTint: 'rgba(5, 223, 114, 0.12)',
    onGain: '#0D0F12',
    loss: '#F87171',
    lossTint: 'rgba(248, 113, 113, 0.12)',
    destructiveBorder: '#EF4444',
    caution: '#FFB178',
    cautionTint: 'rgba(255, 177, 120, 0.12)',
    info: '#60A5FA',
    unrated: '#859585',
  },
  light: {
    canvas: '#F4F5F7',
    surface1: '#FFFFFF',
    surface2: '#ECEEF2',
    border: '#D8DCE3',
    scrim: 'rgba(13, 15, 18, 0.45)',
    textPrimary: '#111418',
    textSecondary: '#4B5563',
    textMuted: '#5B6270',
    gain: '#047857',
    gainPressed: '#065F46',
    gainTint: 'rgba(4, 120, 87, 0.10)',
    onGain: '#FFFFFF',
    loss: '#B91C1C',
    lossTint: 'rgba(185, 28, 28, 0.10)',
    destructiveBorder: '#DC2626',
    caution: '#9A4A07',
    cautionTint: 'rgba(154, 74, 7, 0.12)',
    info: '#1D4ED8',
    unrated: '#5B6270',
  },
};

/** 4 px base spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  /** Screen side margin. */
  margin: 16,
  /** Card inner padding. */
  gutter: 12,
} as const;

/** Corner radii. */
export const radii = {
  sm: 2,
  base: 4,
  md: 6,
  lg: 8,
  xl: 12,
  full: 9999,
} as const;

/** Minimum touch target (LLD §4.5 accessibility). */
export const MIN_TOUCH = 44;

type Weight = keyof typeof INTER;

function type(
  size: number,
  lineHeight: number,
  weight: Weight,
  letterSpacingEm: number,
  tabular = false,
): TextStyle {
  return {
    fontFamily: INTER[weight],
    fontSize: size,
    lineHeight,
    letterSpacing: Math.round(letterSpacingEm * size * 100) / 100,
    ...(tabular ? { fontVariant: ['tabular-nums'] } : {}),
  };
}

/**
 * Type scale. Android picks custom font weights by family name, so each style names its
 * Inter family explicitly. Metric styles use tabular figures.
 */
export const typography = {
  displayHero: type(36, 44, 700, -0.03, true),
  headlineLg: type(28, 34, 600, -0.02),
  headlineMd: type(22, 28, 600, -0.015),
  headlineSm: type(18, 24, 600, -0.01),
  metricLg: type(24, 28, 600, -0.02, true),
  metricMd: type(16, 20, 600, -0.01, true),
  bodyLg: type(15, 22, 400, 0),
  bodyMd: type(13, 18, 400, 0),
  labelMd: type(12, 16, 500, 0.01),
  labelSm: type(11, 14, 500, 0.02),
  microBadge: type(10, 12, 600, 0.04),
} as const satisfies Record<string, TextStyle>;

/** Badge colours for GOOD / AVERAGE / BAD labels; `NONE` = not rated. */
export type LabelColors = Readonly<Record<'GOOD' | 'AVERAGE' | 'BAD' | 'NONE', { fg: string; bg: string }>>;

/** Badge colours for one palette. */
export function labelColorsFor(c: Palette): LabelColors {
  return {
    GOOD: { fg: c.gain, bg: c.gainTint },
    AVERAGE: { fg: c.caution, bg: c.cautionTint },
    BAD: { fg: c.loss, bg: c.lossTint },
    NONE: { fg: c.unrated, bg: c.surface2 },
  };
}
