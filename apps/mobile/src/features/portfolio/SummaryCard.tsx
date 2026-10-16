import type { Currency, MarketSummary, PortfolioSummary } from '@portfolio/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDate, formatFxRate, formatMoney, formatPct, formatSignedMoney } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const MARKET_LABEL = { IN: 'INDIA STOCKS', US: 'US STOCKS' } as const;
const MARKET_COLOR = { IN: colors.caution, US: colors.gain } as const;

const signColor = (n: number | null): string =>
  n === null || !Number.isFinite(n) || n === 0 ? colors.textSecondary : n > 0 ? colors.gain : colors.loss;

/** "+24.8% p.a." or "—" with the < 1 yr hint (CAGR = money-weighted XIRR, LLD §4.9). */
function cagrText(pct: number | null): string {
  return pct === null ? '— (< 1 yr)' : `${formatPct(pct, { signed: true })} p.a.`;
}

function CurrencyToggle({
  value,
  onChange,
}: {
  readonly value: Currency;
  readonly onChange: (c: Currency) => void;
}): React.JSX.Element {
  return (
    <View style={styles.toggle} accessibilityRole="radiogroup">
      {(['USD', 'INR'] as const).map((c) => (
        <Pressable
          key={c}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === c }}
          accessibilityLabel={`Show totals in ${c}`}
          onPress={() => onChange(c)}
          style={[styles.toggleItem, value === c && styles.toggleOn]}
        >
          <Text style={[styles.toggleText, value === c && styles.toggleTextOn]}>
            {c === 'USD' ? '$ USD' : '₹ INR'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function MarketCard({ m }: { readonly m: MarketSummary }): React.JSX.Element {
  return (
    <View style={styles.marketCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.caption}>{MARKET_LABEL[m.market]}</Text>
        <Text style={[styles.weight, { color: MARKET_COLOR[m.market] }]}>{formatPct(m.weightPct)}</Text>
      </View>
      <Text style={styles.marketValue} numberOfLines={1} adjustsFontSizeToFit>
        {formatMoney(m.value, m.currency)}
      </Text>
      <View style={styles.rowBetween}>
        <Text style={styles.small}>CAGR</Text>
        <Text style={[styles.small, { color: signColor(m.xirrPct) }]}>{cagrText(m.xirrPct)}</Text>
      </View>
    </View>
  );
}

function Row({
  label,
  tag,
  value,
  pct,
}: {
  readonly label: string;
  readonly tag: string;
  readonly value: string;
  readonly pct: number | null;
}): React.JSX.Element {
  return (
    <View style={styles.statRow}>
      <View style={styles.statLabel}>
        <Text style={styles.body}>{label}</Text>
        <Text style={styles.tag}>{tag}</Text>
      </View>
      <View style={styles.statValue}>
        <Text style={[styles.metric, { color: signColor(pct) }]}>{value}</Text>
        {pct !== null ? (
          <Text style={[styles.pctChip, { color: signColor(pct) }]}>{formatPct(pct, { signed: true })}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** S02 header (LLD §4.4): totals in the summary currency, FX source and date, per-market cards. */
export function SummaryCard({
  summary,
  onCurrencyChange,
}: {
  readonly summary: PortfolioSummary;
  readonly onCurrencyChange: (c: Currency) => void;
}): React.JSX.Element {
  const c = summary.currency;
  const fxKnown = Number.isFinite(summary.fx.usdInr);
  const inMarket = summary.markets.find((m) => m.market === 'IN');
  const usMarket = summary.markets.find((m) => m.market === 'US');
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.caption}>● NET PORTFOLIO WORTH</Text>
        <CurrencyToggle value={c} onChange={onCurrencyChange} />
      </View>
      <Text style={styles.hero} numberOfLines={1} adjustsFontSizeToFit>
        {formatMoney(summary.totalValue, c)}
      </Text>
      <Text style={styles.small}>
        {fxKnown
          ? `${formatFxRate(summary.fx.usdInr)} · ECB · ${formatDate(summary.fx.asOf, { short: true })}`
          : 'Exchange rate not loaded yet'}
      </Text>

      {summary.markets.length > 0 ? (
        <View style={styles.marketRow}>
          {usMarket ? <MarketCard m={usMarket} /> : null}
          {inMarket ? <MarketCard m={inMarket} /> : null}
        </View>
      ) : null}

      <View style={styles.stats}>
        <Row
          label="1-Day P/L"
          tag="Today"
          value={formatSignedMoney(summary.dayChange, c)}
          pct={summary.dayChangePct}
        />
        <Row
          label="Total unrealised P/L"
          tag="All-time"
          value={formatSignedMoney(summary.unrealisedPnl, c)}
          pct={summary.unrealisedPnlPct}
        />
        <View style={styles.statRow}>
          <View style={styles.statLabel}>
            <Text style={styles.body}>Overall CAGR</Text>
            <Text style={styles.tag}>Annualised</Text>
          </View>
          <Text style={[styles.metric, { color: signColor(summary.xirrPct) }]}>
            {cagrText(summary.xirrPct)}
          </Text>
        </View>
      </View>

      {usMarket && inMarket ? (
        <View
          style={styles.allocation}
          accessibilityLabel={`US ${formatPct(usMarket.weightPct)}, India ${formatPct(inMarket.weightPct)}`}
        >
          <View style={styles.rowBetween}>
            <Text style={styles.small}>US equity</Text>
            <Text style={styles.small}>India</Text>
          </View>
          <View style={styles.bar}>
            <View style={[styles.barPart, { flex: usMarket.weightPct ?? 0, backgroundColor: colors.gain }]} />
            <View
              style={[styles.barPart, { flex: inMarket.weightPct ?? 0, backgroundColor: colors.caution }]}
            />
          </View>
        </View>
      ) : null}
      {summary.unpricedCount > 0 ? (
        <Text
          style={styles.small}
        >{`${summary.unpricedCount} holding(s) without a price yet are not in these totals.`}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  caption: { ...typography.labelSm, color: colors.textSecondary },
  hero: { ...typography.displayHero, color: colors.textPrimary },
  small: { ...typography.labelSm, color: colors.textSecondary },
  body: { ...typography.bodyMd, color: colors.textPrimary },
  metric: { ...typography.metricMd },
  toggle: {
    flexDirection: 'row',
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 2,
  },
  toggleItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    minHeight: 28,
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.surface2 },
  toggleText: { ...typography.labelMd, color: colors.textSecondary },
  toggleTextOn: { color: colors.textPrimary },
  marketRow: { flexDirection: 'row', gap: spacing.md },
  marketCard: {
    flex: 1,
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
  weight: { ...typography.microBadge },
  marketValue: { ...typography.metricLg, color: colors.textPrimary },
  stats: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  statLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1, flexWrap: 'wrap' },
  statValue: { alignItems: 'flex-end' },
  tag: {
    ...typography.microBadge,
    color: colors.textSecondary,
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.base,
    overflow: 'hidden',
  },
  pctChip: { ...typography.labelSm },
  allocation: { gap: spacing.xs },
  bar: {
    flexDirection: 'row',
    height: 6,
    borderRadius: radii.full,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  barPart: { height: 6 },
});
