import type { StockHolding } from '@portfolio/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MarketBadge, SymbolTile } from '@/components/Badges';
import { formatMoney, formatQuantity } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** "Zerodha" or "Zerodha +1" (largest broker by invested first). */
export function brokerLabel(h: StockHolding): string {
  const first = h.brokers[0]?.platform ?? '—';
  return h.brokers.length > 1 ? `${first} +${h.brokers.length - 1}` : first;
}

/**
 * Stock card (S02) with cost basis only: quantity, average price, invested. Close, value, P/L
 * and labels join in M5–M7 when market data and analysis exist.
 */
export function HoldingCard({
  holding,
  onPress,
}: {
  readonly holding: StockHolding;
  readonly onPress: () => void;
}): React.JSX.Element {
  const h = holding;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${h.name}, ${formatQuantity(h.quantity, h.currency)} shares, invested ${formatMoney(h.invested, h.currency)}. Open actions`}
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
            {`${h.symbol} · ${brokerLabel(h)} · ${formatQuantity(h.quantity, h.currency)} Shs · Avg ${formatMoney(h.avgPrice, h.currency)}`}
          </Text>
          {h.sector ? <Text style={styles.sector}>{h.sector}</Text> : null}
        </View>
      </View>
      <View style={styles.bottom}>
        <View>
          <Text style={styles.caption}>INVESTED</Text>
          <Text style={styles.value}>{formatMoney(h.invested, h.currency)}</Text>
        </View>
        <View style={styles.right}>
          <Text style={styles.caption}>CURRENT</Text>
          <Text style={styles.muted}>{formatMoney(h.value, h.currency)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  sector: { ...typography.labelSm, color: colors.textMuted },
  bottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  right: { alignItems: 'flex-end' },
  caption: { ...typography.microBadge, color: colors.textMuted },
  value: { ...typography.metricMd, color: colors.textPrimary },
  muted: { ...typography.metricMd, color: colors.textMuted },
});
