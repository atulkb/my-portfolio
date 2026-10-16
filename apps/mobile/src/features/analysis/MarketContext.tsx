import type { MacroAssessment } from '@portfolio/core';
import { StyleSheet, Text, View } from 'react-native';

import { formatDate, formatPct } from '@/lib/format';
import { useMarket } from '@/stores';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { usdInrMove, useMarketSentiment } from './ai';
import { MarketNote } from './AiVerdict';

const VIX_TEXT = { CALM: 'Calm', ELEVATED: 'Elevated', FEAR: 'Fear' } as const;
const REGIME_TEXT = { ABOVE: 'above', NEAR: 'near', BELOW: 'below' } as const;

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.caption}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

/**
 * Market context (ANALYSIS_FRAMEWORK §6): deterministic VIX levels and index trends, plus USD/INR
 * and the AI note (HLD D34) on S07. S04 Technicals shows the figures only (`withNote` off).
 */
export function MarketContextCard({
  macro,
  withNote,
}: {
  readonly macro: MacroAssessment;
  readonly withNote: boolean;
}): React.JSX.Element {
  const sentiment = useMarketSentiment(macro, withNote);
  const fx = useMarket((s) => s.fx);
  const usdInr = usdInrMove(fx);
  const vix = (v: MacroAssessment['vix']): string =>
    v.value === null || v.level === null ? '—' : `${v.value.toFixed(2)} · ${VIX_TEXT[v.level]}`;
  const trend = (t: MacroAssessment['nifty']): string =>
    t.pctVsSma200 === null || t.regime === null
      ? '—'
      : `${formatPct(t.pctVsSma200, { signed: true })} · ${REGIME_TEXT[t.regime]} 200-day`;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Market context</Text>
      {withNote ? <MarketNote entry={sentiment.entry} /> : null}
      <View style={styles.grid}>
        <Stat label="INDIA VIX" value={vix(macro.indiaVix)} />
        <Stat label="CBOE VIX" value={vix(macro.vix)} />
        <Stat label="NIFTY 50" value={trend(macro.nifty)} />
        <Stat label="S&P 500" value={trend(macro.sp500)} />
        {withNote ? (
          <Stat
            label={fx ? `USD/INR · ECB ${formatDate(fx.asOf, { short: true })}` : 'USD/INR'}
            value={
              usdInr.rate === null
                ? '—'
                : `₹${usdInr.rate.toFixed(2)}${usdInr.changePct === null ? '' : ` (${formatPct(usdInr.changePct, { signed: true })})`}`
            }
          />
        ) : null}
      </View>
      <Text style={styles.muted}>Shown for context; not part of the Health score.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { ...typography.headlineSm, color: colors.textPrimary },
  muted: { ...typography.labelSm, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  stat: { width: '50%', gap: 2, paddingRight: spacing.sm },
  caption: { ...typography.microBadge, color: colors.textMuted },
  statValue: { ...typography.metricMd, color: colors.textPrimary },
});
