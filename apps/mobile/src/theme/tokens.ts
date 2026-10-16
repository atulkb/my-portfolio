/**
 * Design tokens for the "Obsidian Capital" design system
 * (docs/ui/screens/obsidian_capital/DESIGN.md). Dark theme only in v1 (LLD §4.5).
 * Components use these tokens; no colour or spacing literals elsewhere.
 */
import type { TextStyle } from 'react-native';
import { INTER } from './fonts';

/** Colour palette. Status colours are never the only cue: text labels always accompany them. */
export const colors = {
  canvas: '#0D0F12',
  surface1: '#14171D',
  surface2: '#1A1E26',
  border: '#262B35',
  scrim: 'rgba(13, 15, 18, 0.85)',

  textPrimary: '#F3F4F6',
  textSecondary: '#9CA3AF',
  textMuted: '#4B5563',

  /** Gain / bullish, primary actions. */
  gain: '#05DF72',
  gainPressed: '#10B981',
  gainTint: 'rgba(5, 223, 114, 0.12)',
  onGain: '#0D0F12',
  /** Loss / bearish. */
  loss: '#F87171',
  lossTint: 'rgba(248, 113, 113, 0.12)',
  destructiveBorder: '#EF4444',
  /** Average / hold / warnings. */
  caution: '#FFB178',
  cautionTint: 'rgba(255, 177, 120, 0.12)',
  /** Neutral accent: focus rings, info. */
  info: '#60A5FA',
  /** Not rated / insufficient data. */
  unrated: '#859585',
} as const;

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

/** Badge colours for GOOD / AVERAGE / BAD labels; `null` = not rated. */
export const labelColors = {
  GOOD: { fg: colors.gain, bg: colors.gainTint },
  AVERAGE: { fg: colors.caution, bg: colors.cautionTint },
  BAD: { fg: colors.loss, bg: colors.lossTint },
  NONE: { fg: colors.unrated, bg: colors.surface2 },
} as const;
