import { MaterialCommunityIcons } from '@expo/vector-icons';
import { normalisePlatform, type PortfolioSort, type StockHolding } from '@portfolio/core';
import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { priceSourceNote } from '@/lib/format';
import { userMessage } from '@/lib/messages';
import { portfolioStore, sessionStore, toastStore, uiStore, useMarket, usePortfolio, useUi } from '@/stores';
import { hasActiveFilters } from '@/stores/uiStore';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { importCsvFromPicker } from './csvImport';
import { HoldingCard } from './HoldingCard';
import { refreshPortfolio, usePortfolioView } from './hooks';
import { SectorHeader } from './SectorHeader';
import { SpeedDialFab } from './SpeedDialFab';
import { SummaryCard } from './SummaryCard';

const openAddBuy = (): void => router.push('/sheets/add-buy');
const uploadCsv = (): void => void importCsvFromPicker();

/** Sort button cycle (LLD §4.4). */
const SORT_CYCLE: readonly PortfolioSort[] = ['VALUE_DESC', 'DAY_PNL_PCT_DESC', 'PNL_PCT_DESC'];
const SORT_LABEL: Readonly<Record<PortfolioSort, string>> = {
  VALUE_DESC: 'Value',
  DAY_PNL_PCT_DESC: 'Daily P&L',
  PNL_PCT_DESC: 'Total return',
  WEIGHT_DESC: 'Weight',
  NAME_ASC: 'Name',
};

/** S02 Portfolio (LLD §4.4). */
export function PortfolioScreen(): React.JSX.Element {
  const view = usePortfolioView();
  const loadState = usePortfolio((s) => s.loadState);
  const pending = usePortfolio((s) => s.pendingWrites);
  const skipped = usePortfolio((s) => s.skipped);
  const error = usePortfolio((s) => s.error);
  const transactions = usePortfolio((s) => s.transactions);
  const snapshots = useMarket((s) => s.snapshots);
  const refresh = useMarket((s) => s.refresh);
  const filters = useUi((s) => s.portfolioFilters);
  const collapsed = useUi((s) => s.collapsedSectors);

  const platforms = useMemo(
    () => new Set(transactions.map((t) => normalisePlatform(t.platform))).size,
    [transactions],
  );
  const staleCount = useMemo(
    () => view.holdings.filter((h) => snapshots.get(h.key)?.stale).length,
    [view.holdings, snapshots],
  );
  const sections = useMemo(
    () =>
      view.sectors.map((g) => ({
        group: g,
        data: collapsed.includes(g.sector) ? ([] as StockHolding[]) : [...g.holdings],
      })),
    [view.sectors, collapsed],
  );

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
  // Report prices that could not be fetched after a refresh.
  useEffect(() => {
    const report = refresh.report;
    if (!report) return;
    const ok = view.totalHoldings - report.failed.length - report.stale.length;
    if (report.failed.length > 0 || report.stale.length > 0) {
      const text = userMessage(report.failed[0]?.code ?? 'MD_PROVIDER_DOWN', {
        ok,
        total: view.totalHoldings,
      });
      if (text) toastStore.getState().show(text);
    }
    // Only when a refresh finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh.report]);

  const cycleSort = (): void => {
    const i = SORT_CYCLE.indexOf(filters.sort);
    const next = SORT_CYCLE[(i + 1) % SORT_CYCLE.length] ?? 'VALUE_DESC';
    uiStore.getState().setPortfolioFilters({ ...filters, sort: next });
  };

  const header = (
    <View style={styles.headerBlock}>
      <SummaryCard
        summary={view.summary}
        onCurrencyChange={(c) => void sessionStore.getState().updateSettings({ summaryCurrency: c })}
      />
      {staleCount > view.holdings.length / 2 && view.holdings.length > 0 ? (
        <Text style={styles.banner}>
          Some prices are from an earlier session (provider unavailable or a market holiday).
        </Text>
      ) : null}
      <View style={styles.row}>
        <Text style={styles.section}>
          {`PLATFORMS · ${platforms}`}
          {pending > 0 ? <Text style={styles.pending}> · Saving…</Text> : null}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={hasActiveFilters(filters) ? 'Filters, active' : 'Filters'}
          onPress={() => router.push('/sheets/filter')}
          style={styles.pill}
        >
          <MaterialCommunityIcons name="tune-variant" size={16} color={colors.textPrimary} />
          <Text style={styles.pillText}>Filters</Text>
          {hasActiveFilters(filters) ? <View style={styles.dot} /> : null}
        </Pressable>
      </View>
      <View style={styles.row}>
        <Text style={styles.title}>
          Holdings{' '}
          <Text style={styles.count}>
            {view.holdings.length === view.totalHoldings
              ? `(${view.totalHoldings} ${view.totalHoldings === 1 ? 'asset' : 'assets'})`
              : `(${view.holdings.length} of ${view.totalHoldings})`}
          </Text>
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sort by ${SORT_LABEL[filters.sort]}. Change`}
          onPress={cycleSort}
          style={styles.pill}
        >
          <MaterialCommunityIcons name="sort" size={16} color={colors.textPrimary} />
          <Text style={styles.pillText}>{SORT_LABEL[filters.sort]}</Text>
        </Pressable>
      </View>
      {refresh.running && refresh.progress ? (
        <Text
          style={styles.progress}
        >{`Fetching prices ${refresh.progress.done}/${refresh.progress.total}`}</Text>
      ) : null}
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
      ) : view.totalHoldings === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="briefcase-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Add your first stock</Text>
          <Text style={styles.body}>Enter a buy by hand, or upload a CSV exported from your broker.</Text>
          <Button label="Add stock" onPress={openAddBuy} />
          <Button label="Upload CSV" variant="secondary" onPress={uploadCsv} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(h) => h.key}
          ListHeaderComponent={header}
          ListEmptyComponent={<Text style={styles.body}>No holdings match these filters.</Text>}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refresh.running}
              onRefresh={() => void refreshPortfolio(true)}
              tintColor={colors.gain}
              colors={[colors.gain]}
              progressBackgroundColor={colors.surface2}
            />
          }
          renderSectionHeader={({ section }) => (
            <SectorHeader
              group={section.group}
              currency={view.currency}
              collapsed={collapsed.includes(section.group.sector)}
              onToggle={() => uiStore.getState().toggleSector(section.group.sector)}
            />
          )}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <HoldingCard
                holding={item}
                stale={snapshots.get(item.key)?.stale ?? false}
                note={priceSourceNote(snapshots.get(item.key))}
                onPress={() =>
                  router.push({ pathname: '/sheets/holding-actions', params: { key: item.key } })
                }
              />
            </View>
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
  headerBlock: { gap: spacing.lg },
  banner: {
    ...typography.labelMd,
    color: colors.caution,
    backgroundColor: colors.cautionTint,
    padding: spacing.md,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  section: { ...typography.labelSm, color: colors.textSecondary },
  pending: { color: colors.caution },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  pillText: { ...typography.labelMd, color: colors.textPrimary },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gain },
  title: { ...typography.headlineMd, color: colors.textPrimary },
  count: { ...typography.labelMd, color: colors.textSecondary },
  progress: { ...typography.labelSm, color: colors.info },
  item: { marginTop: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  emptyTitle: { ...typography.headlineSm, color: colors.textPrimary },
  body: { ...typography.bodyLg, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg },
});
