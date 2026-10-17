import type { StockHolding } from '@portfolio/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LabelBadge, MarketBadge, SymbolTile } from '@/components/Badges';
import { formatDate, formatMoney, formatPct, formatQuantity, formatSignedMoney } from '@/lib/format';
import { useAi } from '@/stores';
import { radii, spacing, typography, type Palette } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/theme';

/** "Zerodha" or "Zerodha +1" (largest broker by invested first). */
export function brokerLabel(h: StockHolding): string {
  const first = h.brokers[0]?.platform ?? '—';
  return h.brokers.length > 1 ? `${first} +${h.brokers.length - 1}` : first;
}

const signColor = (colors: Palette, n: number | null): string =>
  n === null || n === 0 ? colors.textSecondary : n > 0 ? colors.gain : colors.loss;

/**
 * Stock card (S02, LLD §4.4): symbol tile, name, market, broker, quantity, average, last close
 * with day change, invested, current value, total return and CAGR, plus the Performance (AI,
 * "Not rated" without a valid AI rating) and Health badges, plus the AI reason line.
 */
export function HoldingCard({
  holding,
  stale,
  note = null,
  onPress,
}: {
  readonly holding: StockHolding;
  /** Price is older than the expected session (shows "as of …"). */
  readonly stale: boolean;
  /** Price-source hint ("price from web · indicators as of 14 Oct"). */
  readonly note?: string | null;
  readonly onPress: () => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  const h = holding;
  // Reason only alongside the label it explains (hidden when not rated, LLD §4.4).
  const reason = useAi((s) => (h.performance ? (s.performance[h.key]?.value.reason ?? null) : null));
  const dayUp = (h.dayChangePct ?? 0) >= 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${h.name}, ${formatQuantity(h.quantity, h.currency)} shares, value ${formatMoney(h.value, h.currency)}, return ${formatPct(h.pnlPct, { signed: true })}. Open actions`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <SymbolTile symbol={h.symbol} />
        <View style={styles.main}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {h.name}
            </Text>
            <MarketBadge market={h.market} />
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {`● ${brokerLabel(h)} · ${formatQuantity(h.quantity, h.currency)} Shs · Avg ${formatMoney(h.avgPrice, h.currency)}`}
          </Text>
        </View>
        <View style={styles.price}>
          <Text style={styles.close}>{h.close === null ? 'No price' : formatMoney(h.close, h.currency)}</Text>
          {h.dayChangePct !== null ? (
            <Text
              style={[
                styles.dayChip,
                {
                  color: dayUp ? colors.gain : colors.loss,
                  backgroundColor: dayUp ? colors.gainTint : colors.lossTint,
                },
              ]}
            >
              {`${dayUp ? '▲' : '▼'} ${formatPct(Math.abs(h.dayChangePct))}`}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.badges}>
        <LabelBadge kind="performance" label={h.performance} />
        <LabelBadge kind="health" label={h.health} />
      </View>
      {reason ? (
        <Text style={styles.reason} numberOfLines={2}>
          {reason}
        </Text>
      ) : null}
      {note ? <Text style={styles.stale}>{note}</Text> : null}
      {stale && h.priceDate ? (
        <Text style={styles.stale}>{`as of ${formatDate(h.priceDate, { short: true })}`}</Text>
      ) : null}
      <View style={styles.bottom}>
        <View>
          <Text style={styles.caption}>INVESTED</Text>
          <Text style={styles.value}>{formatMoney(h.invested, h.currency)}</Text>
        </View>
        <View>
          <Text style={styles.caption}>CURRENT</Text>
          <Text style={styles.value}>{formatMoney(h.value, h.currency)}</Text>
        </View>
        <View style={styles.right}>
          <Text style={styles.caption}>TOTAL RETURN</Text>
          <Text style={[styles.value, { color: signColor(colors, h.pnl) }]}>
            {formatSignedMoney(h.pnl, h.currency)}
          </Text>
          <Text style={[styles.small, { color: signColor(colors, h.pnl) }]}>
            {`(${formatPct(h.pnlPct, { signed: true })})${h.xirrPct !== null ? ` · CAGR ${formatPct(h.xirrPct, { signed: true })}` : ''}`}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: spacing.gutter,
      gap: spacing.md,
    },
    pressed: { backgroundColor: colors.surface2 },
    top: { flexDirection: 'row', gap: spacing.md },
    main: { flex: 1, gap: 2 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    name: { ...typography.metricMd, color: colors.textPrimary, flexShrink: 1 },
    meta: { ...typography.labelMd, color: colors.textSecondary },
    price: { alignItems: 'flex-end', gap: 4 },
    close: { ...typography.metricMd, color: colors.textPrimary },
    dayChip: {
      ...typography.labelSm,
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
      borderRadius: radii.base,
      overflow: 'hidden',
    },
    stale: { ...typography.labelSm, color: colors.caution },
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    reason: { ...typography.bodyMd, color: colors.textSecondary },
    bottom: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: spacing.md,
      gap: spacing.sm,
    },
    right: { alignItems: 'flex-end', flexShrink: 1 },
    caption: { ...typography.microBadge, color: colors.textMuted },
    value: { ...typography.metricMd, color: colors.textPrimary },
    small: { ...typography.labelSm },
  }),
);
