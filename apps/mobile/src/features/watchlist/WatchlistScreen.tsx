import { MaterialCommunityIcons } from '@expo/vector-icons';
import { assessMacro, SIGNAL_LABELS, type Market, type SignalLabel } from '@portfolio/core';
import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SIGNAL_TEXT } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Fab } from '@/components/Fab';
import { currentMacro, listSignalItems, useAiSuggestions } from '@/features/analysis/ai';
import { MarketContextCard } from '@/features/analysis/MarketContext';
import { openResearch } from '@/features/analysis/ResearchHomeScreen';
import { refreshPortfolio } from '@/features/portfolio/hooks';
import { userMessage } from '@/lib/messages';
import {
  aiStore,
  toastStore,
  uiStore,
  useAi,
  useMarket,
  useUi,
  useWatchlists,
  watchlistStore,
} from '@/stores';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { useWatchlistView } from './hooks';
import { WatchlistRowCard } from './WatchlistRowCard';

const MARKETS: readonly { label: string; value: Market | null }[] = [
  { label: 'All markets', value: null },
  { label: 'US', value: 'US' },
  { label: 'India', value: 'IN' },
];

const openPick = (): void => router.push('/sheets/watchlist-pick');

function asOf(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** S07 Watchlist (LLD §4.4): lists, market and signal chips, market context, AI signal rows. */
export function WatchlistScreen(): React.JSX.Element {
  const watchlists = useWatchlists((s) => s.watchlists);
  const itemsByList = useWatchlists((s) => s.itemsByList);
  const activeId = useWatchlists((s) => s.activeListId);
  const loadState = useWatchlists((s) => s.loadState);
  const error = useWatchlists((s) => s.error);
  const filters = useUi((s) => s.watchlistFilters);
  const suggestions = useAiSuggestions();
  const signalsRunning = useAi((s) => s.status.signals.running);
  const signalsFailure = useAi((s) => s.status.signals.failure);
  const macroSnapshot = useMarket((s) => s.macro);
  const refreshing = useMarket((s) => s.refresh.running);
  const view = useWatchlistView(activeId);
  const macro = useMemo(() => (macroSnapshot ? assessMacro(macroSnapshot) : null), [macroSnapshot]);

  // Failed writes have already been rolled back; limits hit are reported here too.
  useEffect(() => {
    if (!error || loadState !== 'ready') return;
    const text = userMessage(error);
    if (text) toastStore.getState().show(text);
    watchlistStore.getState().clearError();
  }, [error, loadState]);

  const refreshSignals = (): void => {
    if (!activeId) return;
    const items = listSignalItems(activeId);
    if (items.length > 0) void aiStore.getState().generateSignals(items, currentMacro(), { force: true });
  };

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Watchlist & AI Signals</Text>
        {suggestions ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh signals for this list"
            disabled={signalsRunning}
            onPress={refreshSignals}
            style={styles.pill}
          >
            {signalsRunning ? (
              <ActivityIndicator size="small" color={colors.gain} />
            ) : (
              <MaterialCommunityIcons name="refresh" size={16} color={colors.textPrimary} />
            )}
            <Text style={styles.pillText}>
              {view.signalsAsOf ? `Signals as of ${asOf(view.signalsAsOf)}` : 'No signals yet'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {suggestions && signalsFailure ? (
        <Text style={styles.warn}>{userMessage(signalsFailure) ?? 'Some signals failed.'}</Text>
      ) : null}

      <Pressable
        accessibilityRole="search"
        accessibilityLabel="Search US and India stocks to add"
        onPress={openPick}
        style={styles.search}
      >
        <MaterialCommunityIcons name="magnify" size={20} color={colors.textSecondary} />
        <Text style={styles.searchText}>Search US & India tickers to add</Text>
      </Pressable>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {watchlists.map((l) => {
          const selected = l.id === activeId;
          return (
            <Pressable
              key={l.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${l.name}, ${itemsByList[l.id]?.length ?? 0} stocks`}
              accessibilityHint="Long press to rename or delete"
              onPress={() => watchlistStore.getState().setActive(l.id)}
              onLongPress={() => router.push({ pathname: '/sheets/watchlist-edit', params: { id: l.id } })}
              style={[styles.listChip, selected && styles.listChipOn]}
            >
              <Text style={[styles.listName, selected && styles.listNameOn]}>{l.name}</Text>
              <Text style={styles.listCount}>{itemsByList[l.id]?.length ?? 0}</Text>
              {selected ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Rename or delete ${l.name}`}
                  hitSlop={8}
                  onPress={() => router.push({ pathname: '/sheets/watchlist-edit', params: { id: l.id } })}
                >
                  <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.textSecondary} />
                </Pressable>
              ) : null}
            </Pressable>
          );
        })}
        <Chip label="+ New list" selected={false} onPress={() => router.push('/sheets/watchlist-edit')} />
      </ScrollView>

      <View style={styles.chipsWrap}>
        {MARKETS.map((m) => (
          <Chip
            key={m.label}
            label={m.label}
            selected={filters.market === m.value}
            onPress={() => uiStore.getState().setWatchlistFilters({ ...filters, market: m.value })}
          />
        ))}
      </View>

      {macro ? <MarketContextCard macro={macro} withNote /> : null}

      {suggestions && view.marketRows > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip
            label={`All (${view.marketRows})`}
            selected={filters.signal === null}
            onPress={() => uiStore.getState().setWatchlistFilters({ ...filters, signal: null })}
          />
          {SIGNAL_LABELS.map((label: SignalLabel) => (
            <Chip
              key={label}
              label={`${SIGNAL_TEXT[label]} (${view.signalCounts[label]})`}
              selected={filters.signal === label}
              onPress={() => uiStore.getState().setWatchlistFilters({ ...filters, signal: label })}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );

  const activeName = watchlists.find((l) => l.id === activeId)?.name ?? '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.appBar}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <MaterialCommunityIcons name="bookmark-outline" size={20} color={colors.gain} />
          </View>
          <Text style={styles.appTitle}>WATCHLIST</Text>
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

      {loadState === 'loading' && watchlists.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.gain} />
        </View>
      ) : loadState === 'error' && watchlists.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.body}>{(error && userMessage(error)) ?? 'Couldn’t load your watchlists.'}</Text>
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => void watchlistStore.getState().load()}
          />
        </View>
      ) : (
        <FlatList
          data={view.rows}
          keyExtractor={(r) => r.key}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <Text style={styles.body}>
              {view.totalRows === 0
                ? `${activeName || 'This list'} is empty. Search for a stock to add it.`
                : 'No stocks match these filters.'}
            </Text>
          }
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refreshPortfolio(false)}
              tintColor={colors.gain}
              colors={[colors.gain]}
              progressBackgroundColor={colors.surface2}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.item}>
              <WatchlistRowCard
                row={item}
                onPress={() => openResearch(item.key)}
                onMore={() =>
                  activeId &&
                  router.push({
                    pathname: '/sheets/watchlist-item',
                    params: { listId: activeId, key: item.key },
                  })
                }
              />
            </View>
          )}
          ListFooterComponent={
            <Text style={styles.disclaimer}>
              Signals are AI-generated from computed scores and can be wrong. Not investment advice.
            </Text>
          }
        />
      )}

      <Fab accessibilityLabel="Add a stock to this watchlist" onPress={openPick} />
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
  titleRow: { gap: spacing.sm },
  title: { ...typography.headlineMd, color: colors.textPrimary },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  pillText: { ...typography.labelMd, color: colors.textPrimary },
  warn: { ...typography.labelMd, color: colors.caution },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  searchText: { ...typography.bodyMd, color: colors.textSecondary },
  chips: { gap: spacing.sm, paddingRight: spacing.margin },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  listChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  listChipOn: { borderColor: colors.gain, backgroundColor: colors.gainTint },
  listName: { ...typography.labelMd, color: colors.textSecondary },
  listNameOn: { color: colors.gain },
  listCount: {
    ...typography.labelSm,
    color: colors.textPrimary,
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.base,
    overflow: 'hidden',
  },
  item: { marginTop: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  body: { ...typography.bodyLg, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg },
  disclaimer: {
    ...typography.labelSm,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
