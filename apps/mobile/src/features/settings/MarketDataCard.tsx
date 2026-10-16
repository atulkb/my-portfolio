import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { refreshPortfolio } from '@/features/portfolio/hooks';
import { formatDate } from '@/lib/format';
import { useMarket } from '@/stores';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * "Market data · Prices as of 15 Oct close · Refresh" (LLD §4.4 S09): a forced refresh that
 * refetches every price, ignoring the same-session cache.
 */
export function MarketDataCard(): React.JSX.Element {
  const snapshots = useMarket((s) => s.snapshots);
  const running = useMarket((s) => s.refresh.running);
  const latest = useMemo(() => {
    let max: string | null = null;
    for (const s of snapshots.values()) if (max === null || s.sessionDate > max) max = s.sessionDate;
    return max;
  }, [snapshots]);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>Market data</Text>
        {running ? <ActivityIndicator color={colors.gain} accessibilityLabel="Refreshing prices" /> : null}
      </View>
      <Text style={styles.sub}>
        {latest ? `Prices as of ${formatDate(latest, { short: true })} close` : 'No prices yet'}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh market data now"
        disabled={running}
        onPress={() => void refreshPortfolio(true)}
      >
        <Text style={[styles.link, running && styles.disabled]}>Refresh now</Text>
      </Pressable>
    </View>
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.headlineSm, color: colors.textPrimary },
  sub: { ...typography.bodyMd, color: colors.textSecondary },
  link: { ...typography.labelMd, color: colors.info },
  disabled: { opacity: 0.5 },
});
