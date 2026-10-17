import type { Exchange, Label, Market, SignalLabel } from '@portfolio/core';
import { StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography, type LabelColors } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/theme';

const LABEL_TEXT: Readonly<Record<Label, string>> = { GOOD: 'Good', AVERAGE: 'Average', BAD: 'Bad' };

/** Display text for AI signal labels (ANALYSIS_FRAMEWORK §7.2). */
export const SIGNAL_TEXT: Readonly<Record<SignalLabel, string>> = {
  STRONG_BUY: 'Strong buy',
  BUY: 'Buy',
  HOLD: 'Hold',
  TRIM: 'Trim',
  SELL: 'Sell',
};

const SIGNAL_TONE: Readonly<Record<SignalLabel, keyof LabelColors>> = {
  STRONG_BUY: 'GOOD',
  BUY: 'GOOD',
  HOLD: 'AVERAGE',
  TRIM: 'BAD',
  SELL: 'BAD',
};

/** AI signal chip, e.g. "Buy · AI confidence 84%" (shown only when AI suggestions are on). */
export function SignalBadge({
  label,
  confidencePct,
  compact = false,
}: {
  readonly label: SignalLabel;
  readonly confidencePct: number;
  /** "Buy · AI conf. 84%" for list rows (S07). */
  readonly compact?: boolean;
}): React.JSX.Element {
  const { labelColors } = useTheme();
  const styles = useStyles();
  const c = labelColors[SIGNAL_TONE[label]];
  const text = `${SIGNAL_TEXT[label]} · AI ${compact ? 'conf.' : 'confidence'} ${Math.round(confidencePct)}%`;
  return (
    <Text
      style={[styles.label, { color: c.fg, backgroundColor: c.bg, borderColor: c.fg }]}
      accessibilityLabel={`AI signal: ${text}`}
    >
      {text}
    </Text>
  );
}

/**
 * Performance or Health badge (LLD §4.5). `null` shows "Not rated" (Performance) or
 * "Insufficient data" (Health) in grey; text always accompanies the colour.
 */
export function LabelBadge({
  kind,
  label,
  score,
}: {
  readonly kind: 'performance' | 'health';
  readonly label: Label | null;
  /** Health score 0–100, shown as "Health 72 · Good". */
  readonly score?: number | null;
}): React.JSX.Element {
  const { labelColors } = useTheme();
  const styles = useStyles();
  const c = labelColors[label ?? 'NONE'];
  const text =
    label === null
      ? kind === 'performance'
        ? 'Not rated'
        : 'Health: Insufficient data'
      : kind === 'performance'
        ? LABEL_TEXT[label]
        : score === null || score === undefined
          ? `Health: ${LABEL_TEXT[label]}`
          : `Health ${Math.round(score)} · ${LABEL_TEXT[label]}`;
  return (
    <Text
      style={[styles.label, { color: c.fg, backgroundColor: c.bg, borderColor: c.fg }]}
      accessibilityLabel={`${kind === 'performance' ? 'Performance' : 'Health'}: ${label === null ? (kind === 'performance' ? 'not rated' : 'insufficient data') : LABEL_TEXT[label]}`}
    >
      {text}
    </Text>
  );
}

/** Square ticker tile on stock cards (first 4–5 characters of the symbol). */
export function SymbolTile({ symbol }: { readonly symbol: string }): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.tile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={styles.tileText} numberOfLines={1} adjustsFontSizeToFit>
        {symbol.slice(0, 5)}
      </Text>
    </View>
  );
}

/** "IN" / "US" market badge. */
export function MarketBadge({ market }: { readonly market: Market }): React.JSX.Element {
  const styles = useStyles();
  return (
    <Text style={styles.market} accessibilityLabel={market === 'IN' ? 'India' : 'United States'}>
      {market}
    </Text>
  );
}

/** Exchange label ("NSE", "NYSE ARCA"). */
export function ExchangeBadge({ exchange }: { readonly exchange: Exchange }): React.JSX.Element {
  const styles = useStyles();
  return <Text style={styles.exchange}>{exchange.replace('_', ' ')}</Text>;
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    tile: {
      width: 44,
      height: 44,
      borderRadius: radii.md,
      backgroundColor: colors.surface2,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xs,
    },
    tileText: { ...typography.microBadge, color: colors.textPrimary },
    label: {
      ...typography.labelSm,
      borderWidth: 1,
      borderRadius: radii.base,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      overflow: 'hidden',
      alignSelf: 'flex-start',
    },
    market: { ...typography.microBadge, color: colors.textSecondary },
    exchange: {
      ...typography.microBadge,
      color: colors.textSecondary,
      backgroundColor: colors.surface2,
      borderRadius: radii.base,
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
      overflow: 'hidden',
    },
  }),
);
