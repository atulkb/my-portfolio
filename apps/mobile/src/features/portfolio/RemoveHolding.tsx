import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { InstrumentKey } from '@portfolio/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { formatMoney, formatQuantity } from '@/lib/format';
import { portfolioStore, toastStore } from '@/stores';
import { radii, spacing, typography } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/theme';
import { useHolding } from './hooks';

function Option({
  title,
  subtitle,
  selected,
  disabled = false,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View
      accessible
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`${title}. ${subtitle}`}
      style={[styles.option, selected && styles.optionOn, disabled && styles.disabled]}
    >
      <MaterialCommunityIcons
        name={selected ? 'radiobox-marked' : 'radiobox-blank'}
        size={22}
        color={selected ? colors.loss : colors.textMuted}
      />
      <View style={styles.flex}>
        <Text style={[styles.optionTitle, selected && { color: colors.loss }]}>{title}</Text>
        <Text style={styles.sub}>{subtitle}</Text>
      </View>
    </View>
  );
}

/**
 * S02b → Remove confirmation (LLD §1.12): lists brokers and quantities; v1 deletes every buy
 * ("Keep history" needs SELL transactions and is shown disabled, D20).
 */
export function RemoveHolding({ holdingKey }: { readonly holdingKey: InstrumentKey }): React.JSX.Element {
  const styles = useStyles();
  const holding = useHolding(holdingKey);
  const [busy, setBusy] = useState(false);
  if (!holding) return <Text style={styles.sub}>This stock is no longer in your portfolio.</Text>;
  const buys = holding.brokers.reduce((n, b) => n + b.buys.length, 0);

  async function remove(): Promise<void> {
    setBusy(true);
    const ok = await portfolioStore.getState().removeHolding(holdingKey);
    setBusy(false);
    if (ok) {
      toastStore.getState().show(`${holding?.symbol ?? 'Stock'} removed.`);
      router.back();
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{`Remove ${holding.symbol}?`}</Text>
      <Text style={styles.sub}>{`${buys} ${buys === 1 ? 'buy' : 'buys'} will be deleted:`}</Text>
      <View style={styles.card}>
        {holding.brokers.map((b) => (
          <View key={b.platform} style={styles.brokerRow}>
            <Text style={styles.broker}>{b.platform}</Text>
            <Text style={styles.sub}>
              {`${formatQuantity(b.quantity, holding.currency)} shares · ${formatMoney(b.invested, holding.currency)}`}
            </Text>
          </View>
        ))}
      </View>
      <Option title="Delete all records" subtitle="Permanently delete every buy of this stock" selected />
      <Option
        title="Keep transaction history"
        subtitle="Coming later (needs sell records)"
        selected={false}
        disabled
      />
      <Button
        label="Remove from portfolio"
        variant="destructive"
        loading={busy}
        onPress={() => void remove()}
      />
      <Button label="Cancel" variant="link" onPress={() => router.back()} />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: spacing.md },
    flex: { flex: 1 },
    title: { ...typography.headlineMd, color: colors.textPrimary },
    sub: { ...typography.labelMd, color: colors.textSecondary },
    card: {
      backgroundColor: colors.surface1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.lg,
      padding: spacing.gutter,
      gap: spacing.sm,
    },
    brokerRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
    broker: { ...typography.bodyMd, color: colors.textPrimary },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.gutter,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    optionOn: { borderColor: colors.destructiveBorder },
    optionTitle: { ...typography.bodyLg, color: colors.textPrimary },
    disabled: { opacity: 0.5 },
  }),
);
