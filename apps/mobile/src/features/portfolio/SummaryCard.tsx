import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Currency, MarketSummary, PortfolioSummary } from '@portfolio/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDate, formatFxRate, formatMoney, formatPct, formatSignedMoney } from '@/lib/format';
import { MIN_TOUCH, radii, spacing, typography, type Palette } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/theme';

const MARKET_LABEL = { IN: 'INDIA STOCKS', US: 'US STOCKS' } as const;
const MARKET_TONE = { IN: 'caution', US: 'gain' } as const satisfies Record<string, keyof Palette>;

/** Shown in place of every figure while the summary is hidden (LLD §4.18). */
const MASK = '••••••';

const signColor = (colors: Palette, n: number | null): string =>
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
  const styles = useStyles();
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

function MarketCard({
  m,
  hidden,
}: {
  readonly m: MarketSummary;
  readonly hidden: boolean;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.marketCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.caption}>{MARKET_LABEL[m.market]}</Text>
        <Text
          style={[styles.weight, { color: hidden ? colors.textSecondary : colors[MARKET_TONE[m.market]] }]}
        >
          {hidden ? MASK : formatPct(m.weightPct)}
        </Text>
      </View>
      <Text style={styles.marketValue} numberOfLines={1} adjustsFontSizeToFit>
        {hidden ? MASK : formatMoney(m.value, m.currency)}
      </Text>
      <View style={styles.rowBetween}>
        <Text style={styles.small}>CAGR</Text>
        <Text style={[styles.small, { color: hidden ? colors.textSecondary : signColor(colors, m.xirrPct) }]}>
          {hidden ? MASK : cagrText(m.xirrPct)}
        </Text>
      </View>
    </View>
  );
}

function Row({
  label,
  tag,
  value,
  pct,
  hidden,
}: {
  readonly label: string;
  readonly tag: string;
  readonly value: string;
  readonly pct: number | null;
  readonly hidden: boolean;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.statRow}>
      <View style={styles.statLabel}>
        <Text style={styles.body}>{label}</Text>
        <Text style={styles.tag}>{tag}</Text>
      </View>
      <View style={styles.statValue}>
        <Text style={[styles.metric, { color: hidden ? colors.textSecondary : signColor(colors, pct) }]}>
          {hidden ? MASK : value}
        </Text>
        {pct !== null && !hidden ? (
          <Text style={[styles.pctChip, { color: signColor(colors, pct) }]}>
            {formatPct(pct, { signed: true })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * S02 header (LLD §4.4): totals in the summary currency, FX source and date, per-market cards.
 * The eye button masks every figure in the card (LLD §4.18) so it can be opened in public.
 */
export function SummaryCard({
  summary,
  hidden,
  onCurrencyChange,
  onToggleHidden,
}: {
  readonly summary: PortfolioSummary;
  readonly hidden: boolean;
  readonly onCurrencyChange: (c: Currency) => void;
  readonly onToggleHidden: () => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  const c = summary.currency;
  const fxKnown = Number.isFinite(summary.fx.usdInr);
  const inMarket = summary.markets.find((m) => m.market === 'IN');
  const usMarket = summary.markets.find((m) => m.market === 'US');
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={styles.titleRow}>
          <Text style={styles.caption}>● NET PORTFOLIO WORTH</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show portfolio totals' : 'Hide portfolio totals'}
            onPress={onToggleHidden}
            hitSlop={(MIN_TOUCH - 24) / 2}
            style={styles.eye}
          >
            <MaterialCommunityIcons
              name={hidden ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        </View>
        <CurrencyToggle value={c} onChange={onCurrencyChange} />
      </View>
      <Text
        style={styles.hero}
        numberOfLines={1}
        adjustsFontSizeToFit
        accessibilityLabel={hidden ? 'Net portfolio worth hidden' : undefined}
      >
        {hidden ? MASK : formatMoney(summary.totalValue, c)}
      </Text>
      <Text style={styles.small}>
        {fxKnown
          ? `${formatFxRate(summary.fx.usdInr)} · ECB · ${formatDate(summary.fx.asOf, { short: true })}`
          : 'Exchange rate not loaded yet'}
      </Text>

      {summary.markets.length > 0 ? (
        <View style={styles.marketRow}>
          {usMarket ? <MarketCard m={usMarket} hidden={hidden} /> : null}
          {inMarket ? <MarketCard m={inMarket} hidden={hidden} /> : null}
        </View>
      ) : null}

      <View style={styles.stats}>
        <Row
          label="1-Day P/L"
          tag="Today"
          value={formatSignedMoney(summary.dayChange, c)}
          pct={summary.dayChangePct}
          hidden={hidden}
        />
        <Row
          label="Total unrealised P/L"
          tag="All-time"
          value={formatSignedMoney(summary.unrealisedPnl, c)}
          pct={summary.unrealisedPnlPct}
          hidden={hidden}
        />
        <View style={styles.statRow}>
          <View style={styles.statLabel}>
            <Text style={styles.body}>Overall CAGR</Text>
            <Text style={styles.tag}>Annualised</Text>
          </View>
          <Text
            style={[
              styles.metric,
              { color: hidden ? colors.textSecondary : signColor(colors, summary.xirrPct) },
            ]}
          >
            {hidden ? MASK : cagrText(summary.xirrPct)}
          </Text>
        </View>
      </View>

      {usMarket && inMarket && !hidden ? (
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

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
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
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
    eye: { padding: 2 },
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
    statLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      flexShrink: 1,
      flexWrap: 'wrap',
    },
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
  }),
);
