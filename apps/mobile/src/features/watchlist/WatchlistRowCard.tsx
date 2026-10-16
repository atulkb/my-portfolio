import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ExchangeBadge, LabelBadge, MarketBadge, SignalBadge, SymbolTile } from '@/components/Badges';
import { PriceChart } from '@/components/PriceChart';
import { formatMoney, formatPct } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import type { WatchlistRow } from './rows';

/**
 * S07 row (LLD §4.4): symbol, market + exchange, name, close with day change, 3-month sparkline,
 * AI signal with confidence (Health when AI suggestions are off), targets and the AI reason.
 */
export function WatchlistRowCard({
  row,
  onPress,
  onMore,
}: {
  readonly row: WatchlistRow;
  readonly onPress: () => void;
  /** Long-press / ⋮: edit targets and notes, copy or move, remove. */
  readonly onMore: () => void;
}): React.JSX.Element {
  const up = (row.dayChangePct ?? 0) >= 0;
  const { targetEntryPrice: entry, targetExitPrice: exit } = row.item;
  const targets = [
    entry !== null ? `Target entry ${formatMoney(entry, row.currency)}` : null,
    exit !== null ? `Target exit ${formatMoney(exit, row.currency)}` : null,
  ].filter((t): t is string => t !== null);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.symbol}, ${row.name}, close ${formatMoney(row.close, row.currency)}. Open research`}
      accessibilityHint="Long press for list actions"
      onPress={onPress}
      onLongPress={onMore}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <SymbolTile symbol={row.symbol} />
        <View style={styles.main}>
          <View style={styles.row}>
            <Text style={styles.symbol}>{row.symbol}</Text>
            <MarketBadge market={row.market} />
            <ExchangeBadge exchange={row.exchange} />
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {row.name}
          </Text>
        </View>
        <View style={styles.price}>
          <Text style={styles.close}>
            {row.close === null ? 'No price' : formatMoney(row.close, row.currency)}
          </Text>
          {row.dayChangePct !== null ? (
            <Text
              style={[
                styles.dayChip,
                {
                  color: up ? colors.gain : colors.loss,
                  backgroundColor: up ? colors.gainTint : colors.lossTint,
                },
              ]}
            >
              {`${up ? '▲' : '▼'} ${formatPct(Math.abs(row.dayChangePct))}`}
            </Text>
          ) : null}
          {row.stale ? <Text style={styles.stale}>older price</Text> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${row.symbol}`}
          hitSlop={10}
          onPress={onMore}
        >
          <MaterialCommunityIcons name="dots-vertical" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.middle}>
        <View style={styles.badges}>
          {row.signal ? (
            <SignalBadge
              label={row.signal.value.label}
              confidencePct={row.signal.value.confidencePct}
              compact
            />
          ) : (
            <LabelBadge kind="health" label={row.health} score={row.healthScore} />
          )}
          {targets.map((t) => (
            <Text key={t} style={styles.target}>
              {t}
            </Text>
          ))}
        </View>
        <View style={styles.spark}>
          <PriceChart values={row.spark} height={40} />
        </View>
      </View>
      {row.signal ? (
        <Text style={styles.reason} numberOfLines={1}>
          {row.signal.value.reason}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.gutter,
    gap: spacing.sm,
  },
  pressed: { backgroundColor: colors.surface2 },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  main: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  symbol: { ...typography.metricMd, color: colors.textPrimary },
  name: { ...typography.bodyMd, color: colors.textSecondary },
  price: { alignItems: 'flex-end', gap: 2 },
  close: { ...typography.metricMd, color: colors.textPrimary },
  dayChip: {
    ...typography.labelSm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.base,
    overflow: 'hidden',
  },
  stale: { ...typography.labelSm, color: colors.caution },
  middle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badges: { flex: 1, gap: spacing.xs },
  target: { ...typography.labelMd, color: colors.textPrimary },
  spark: { width: 110 },
  reason: { ...typography.labelMd, color: colors.textSecondary },
});
