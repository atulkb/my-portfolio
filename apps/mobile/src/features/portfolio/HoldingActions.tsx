import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { InstrumentKey } from '@portfolio/core';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SymbolTile } from '@/components/Badges';
import { MIN_TOUCH, radii, spacing, typography } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/theme';
import { useHolding } from './hooks';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
  destructive = false,
  disabled = false,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly subtitle: string;
  readonly onPress: () => void;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  const fg = destructive ? colors.loss : colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        destructive && styles.destructive,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={22} color={destructive ? colors.loss : colors.gain} />
      <View style={styles.flex}>
        <Text style={[styles.rowTitle, { color: fg }]}>{title}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
    </Pressable>
  );
}

/** S02b Holding actions sheet (LLD §4.4). */
export function HoldingActions({ holdingKey }: { readonly holdingKey: InstrumentKey }): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  const holding = useHolding(holdingKey);
  if (!holding) {
    return <Text style={styles.rowSub}>This stock is no longer in your portfolio.</Text>;
  }
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <SymbolTile symbol={holding.symbol} />
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={1}>{`${holding.name} (${holding.symbol})`}</Text>
          <Text style={styles.rowSub}>Holding actions</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          onPress={() => router.back()}
        >
          <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>
      <ActionRow
        icon="chart-timeline-variant"
        title="View deep research & rules"
        subtitle="Health, fundamentals, technicals and your position"
        onPress={() => {
          router.back();
          router.navigate({ pathname: '/research/[key]', params: { key: holding.key } });
        }}
      />
      <ActionRow
        icon="pencil-outline"
        title="Edit buys"
        subtitle="Change prices, shares, dates or platform, per broker"
        onPress={() => router.replace({ pathname: '/holding/[key]/edit', params: { key: holding.key } })}
      />
      <ActionRow
        icon="delete-outline"
        title="Remove from portfolio"
        subtitle="Delete every buy of this stock"
        destructive
        onPress={() => router.replace({ pathname: '/sheets/remove-holding', params: { key: holding.key } })}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: spacing.md },
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
    title: { ...typography.headlineSm, color: colors.textPrimary },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: MIN_TOUCH + 12,
      padding: spacing.gutter,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    destructive: { borderColor: colors.destructiveBorder, backgroundColor: colors.lossTint },
    pressed: { backgroundColor: colors.surface2 },
    disabled: { opacity: 0.5 },
    rowTitle: { ...typography.metricMd },
    rowSub: { ...typography.labelMd, color: colors.textSecondary },
  }),
);
