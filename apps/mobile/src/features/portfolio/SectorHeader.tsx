import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Currency, SectorGroup } from '@portfolio/core';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMoney, formatPct, formatSignedMoney } from '@/lib/format';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** Collapsible sector header (S02): name, count, value, P/L and weight in the summary currency. */
export function SectorHeader({
  group,
  currency,
  collapsed,
  onToggle,
}: {
  readonly group: SectorGroup;
  readonly currency: Currency;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  const up = group.pnl >= 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={`${group.sector}, ${group.holdings.length} holdings. ${collapsed ? 'Expand' : 'Collapse'}`}
      onPress={onToggle}
      style={styles.header}
    >
      <MaterialCommunityIcons
        name={collapsed ? 'chevron-right' : 'chevron-down'}
        size={20}
        color={colors.textSecondary}
      />
      <Text style={styles.name} numberOfLines={1}>
        {group.sector}
      </Text>
      <Text style={styles.count}>{group.holdings.length}</Text>
      <View style={styles.right}>
        <Text style={styles.value}>{formatMoney(group.value, currency)}</Text>
        <Text style={[styles.small, { color: up ? colors.gain : colors.loss }]}>
          {`${formatSignedMoney(group.pnl, currency)} (${formatPct(group.pnlPct, { signed: true })})`}
          <Text style={styles.weight}>{` · ${formatPct(group.weightPct)}`}</Text>
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.gutter,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    marginTop: spacing.md,
  },
  name: { ...typography.metricMd, color: colors.textPrimary, flexShrink: 1 },
  count: {
    ...typography.microBadge,
    color: colors.textSecondary,
    backgroundColor: colors.surface1,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.base,
    overflow: 'hidden',
  },
  right: { marginLeft: 'auto', alignItems: 'flex-end' },
  value: { ...typography.labelMd, color: colors.textPrimary },
  small: { ...typography.labelSm },
  weight: { color: colors.textSecondary },
});
