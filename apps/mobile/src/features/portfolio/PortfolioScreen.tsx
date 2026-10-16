import { MaterialCommunityIcons } from '@expo/vector-icons';
import { EXCHANGE_META, normalisePlatform, type Currency, type StockHolding } from '@portfolio/core';
import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { userMessage } from '@/lib/messages';
import { formatMoney } from '@/lib/format';
import { portfolioStore, toastStore, usePortfolio } from '@/stores';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { importCsvFromPicker } from './csvImport';
import { HoldingCard } from './HoldingCard';
import { useHoldings } from './hooks';
import { SpeedDialFab } from './SpeedDialFab';

const openAddBuy = (): void => router.push('/sheets/add-buy');
const uploadCsv = (): void => void importCsvFromPicker();

/** Invested per currency (holdings stay native; no FX conversion before M5). */
function investedByCurrency(holdings: readonly StockHolding[]): Record<Currency, number> {
  const out: Record<Currency, number> = { INR: 0, USD: 0 };
  for (const h of holdings) out[h.currency] += h.invested;
  return out;
}

/**
 * S02 Portfolio, M4 version: holdings from the buy transactions (cost basis), + menu, empty
 * state. Prices, P/L, sectors and the summary header arrive with market data in M5.
 */
export function PortfolioScreen(): React.JSX.Element {
  const holdings = useHoldings();
  const loadState = usePortfolio((s) => s.loadState);
  const pending = usePortfolio((s) => s.pendingWrites);
  const skipped = usePortfolio((s) => s.skipped);
  const error = usePortfolio((s) => s.error);
  const transactions = usePortfolio((s) => s.transactions);

  const platforms = useMemo(
    () => new Set(transactions.map((t) => normalisePlatform(t.platform))).size,
    [transactions],
  );
  const invested = useMemo(() => investedByCurrency(holdings), [holdings]);
  const markets = useMemo(() => new Set(holdings.map((h) => EXCHANGE_META[h.exchange].market)), [holdings]);

  // One-time notices: unreadable documents, failed writes (already rolled back).
  useEffect(() => {
    if (skipped > 0) {
      const text = userMessage('FS_INVALID_DOC', { count: skipped });
      if (text) toastStore.getState().show(text);
    }
  }, [skipped]);
  useEffect(() => {
    if (error && loadState === 'ready') {
      const text = userMessage(error);
      if (text) toastStore.getState().show(text);
      portfolioStore.getState().clearError();
    }
  }, [error, loadState]);

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.summary}>
        <Text style={styles.caption}>INVESTED</Text>
        {markets.has('IN') || holdings.length === 0 ? (
          <Text style={styles.metric}>{formatMoney(invested.INR, 'INR')}</Text>
        ) : null}
        {markets.has('US') ? <Text style={styles.metric}>{formatMoney(invested.USD, 'USD')}</Text> : null}
        <Text style={styles.hint}>Prices, P/L and CAGR appear once market data is added.</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.section}>{`PLATFORMS · ${platforms}`}</Text>
        {pending > 0 ? <Text style={styles.pending}>Saving…</Text> : null}
      </View>
      <Text style={styles.title}>
        Holdings{' '}
        <Text
          style={styles.count}
        >{`(${holdings.length} ${holdings.length === 1 ? 'asset' : 'assets'})`}</Text>
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.appBar}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <MaterialCommunityIcons name="chart-line-variant" size={20} color={colors.gain} />
          </View>
          <Text style={styles.appTitle}>PORTFOLIO</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={10}
          onPress={() => router.push('/settings')}
        >
          <MaterialCommunityIcons name="cog-outline" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>

      {loadState === 'loading' && transactions.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.gain} />
        </View>
      ) : loadState === 'error' && transactions.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.body}>{(error && userMessage(error)) ?? 'Couldn’t load your portfolio.'}</Text>
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => void portfolioStore.getState().load()}
          />
        </View>
      ) : holdings.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="briefcase-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Add your first stock</Text>
          <Text style={styles.body}>Enter a buy by hand, or upload a CSV exported from your broker.</Text>
          <Button label="Add stock" onPress={openAddBuy} />
          <Button label="Upload CSV" variant="secondary" onPress={uploadCsv} />
        </View>
      ) : (
        <FlatList
          data={holdings}
          keyExtractor={(h) => h.key}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          renderItem={({ item }) => (
            <HoldingCard
              holding={item}
              onPress={() => router.push({ pathname: '/sheets/holding-actions', params: { key: item.key } })}
            />
          )}
        />
      )}

      <SpeedDialFab
        actions={[
          { label: 'Add stock', icon: 'plus-circle-outline', onPress: openAddBuy },
          { label: 'Upload CSV', icon: 'file-upload-outline', onPress: uploadCsv },
        ]}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  appBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.margin,
    paddingVertical: spacing.md,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appTitle: { ...typography.headlineSm, color: colors.textPrimary },
  list: { padding: spacing.margin, paddingBottom: 120 },
  headerBlock: { gap: spacing.lg, marginBottom: spacing.lg },
  summary: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  caption: { ...typography.labelSm, color: colors.textSecondary },
  metric: { ...typography.metricLg, color: colors.textPrimary },
  hint: { ...typography.labelSm, color: colors.textMuted, marginTop: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { ...typography.labelSm, color: colors.textSecondary },
  pending: { ...typography.labelSm, color: colors.caution },
  title: { ...typography.headlineMd, color: colors.textPrimary },
  count: { ...typography.labelMd, color: colors.textSecondary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  emptyTitle: { ...typography.headlineSm, color: colors.textPrimary },
  body: { ...typography.bodyLg, color: colors.textSecondary, textAlign: 'center' },
});
