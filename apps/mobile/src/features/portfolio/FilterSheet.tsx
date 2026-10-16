import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  aggregateHoldings,
  groupBySector,
  NO_FILTERS,
  normalisePlatform,
  type Exchange,
  type LabelFilter,
  type Market,
  type PortfolioFilters,
  type PortfolioSort,
} from '@portfolio/core';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { formatPct } from '@/lib/format';
import { uiStore, usePortfolio, useSession, useUi } from '@/stores';
import { colors, MIN_TOUCH, radii, spacing, typography } from '@/theme/tokens';
import { useHoldings, usePricingContext } from './hooks';

const LABEL_CHIPS: readonly { value: LabelFilter; label: string }[] = [
  { value: 'GOOD', label: 'Good' },
  { value: 'AVERAGE', label: 'Average' },
  { value: 'BAD', label: 'Bad' },
  { value: 'NONE', label: 'Not rated' },
];
const SORTS: readonly { value: PortfolioSort; label: string }[] = [
  { value: 'VALUE_DESC', label: 'Highest value' },
  { value: 'DAY_PNL_PCT_DESC', label: 'Daily P&L %' },
  { value: 'PNL_PCT_DESC', label: 'Total return %' },
  { value: 'WEIGHT_DESC', label: 'Allocation weight' },
];

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function CheckRow({
  title,
  subtitle,
  right,
  checked,
  onPress,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly right?: string;
  readonly checked: boolean;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      style={styles.checkRow}
    >
      <MaterialCommunityIcons
        name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
        size={22}
        color={checked ? colors.gain : colors.textMuted}
      />
      <View style={styles.flex}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {right ? <Text style={styles.rowRight}>{right}</Text> : null}
    </Pressable>
  );
}

/** S02a Filter sheet (LLD §4.4): draft filters with a live match count; Apply writes `uiStore`. */
export function FilterSheet(): React.JSX.Element {
  const applied = useUi((s) => s.portfolioFilters);
  const [draft, setDraft] = useState<PortfolioFilters>(applied);
  const all = useHoldings();
  const transactions = usePortfolio((s) => s.transactions);
  const ctx = usePricingContext();
  const currency = useSession((s) => s.profile?.settings.summaryCurrency ?? 'INR');

  const matched = useMemo(
    () => aggregateHoldings(transactions, ctx, draft).length,
    [transactions, ctx, draft],
  );
  const sectors = useMemo(() => groupBySector(all, ctx.fx, currency), [all, ctx.fx, currency]);
  const marketCount = (m: Market): number => all.filter((h) => h.market === m).length;
  const exchanges = useMemo(() => [...new Set(all.map((h) => h.exchange))].sort(), [all]);
  const platforms = useMemo(() => {
    const byName = new Map<string, { name: string; holdings: Set<string> }>();
    for (const t of transactions) {
      const k = normalisePlatform(t.platform);
      const entry = byName.get(k) ?? { name: t.platform, holdings: new Set<string>() };
      entry.holdings.add(`${t.exchange}:${t.symbol}`);
      byName.set(k, entry);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [transactions]);

  const set = (patch: Partial<PortfolioFilters>): void => setDraft((d) => ({ ...d, ...patch }));

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.title}>Filter</Text>
          <Text style={styles.sub}>Narrow the holdings list</Text>
        </View>
        <Button label="Reset" variant="link" onPress={() => setDraft(NO_FILTERS)} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          onPress={() => router.back()}
        >
          <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.matchCard}>
        <Text style={styles.rowTitle}>● Matched assets</Text>
        <Text style={styles.matchCount}>
          {matched}
          <Text style={styles.sub}>{` / ${all.length}`}</Text>
        </Text>
      </View>

      <Text style={styles.section}>1. MARKET</Text>
      <View style={styles.chips}>
        <Chip
          label={`All markets · ${all.length}`}
          selected={draft.markets.length === 0}
          onPress={() => set({ markets: [] })}
        />
        <Chip
          label={`US · ${marketCount('US')}`}
          selected={draft.markets.includes('US')}
          onPress={() => set({ markets: toggle(draft.markets, 'US') })}
        />
        <Chip
          label={`India · ${marketCount('IN')}`}
          selected={draft.markets.includes('IN')}
          onPress={() => set({ markets: toggle(draft.markets, 'IN') })}
        />
      </View>

      <Text style={styles.section}>2. EXCHANGE</Text>
      <View style={styles.chips}>
        <Chip
          label="All exchanges"
          selected={draft.exchanges.length === 0}
          onPress={() => set({ exchanges: [] })}
        />
        {exchanges.map((e: Exchange) => (
          <Chip
            key={e}
            label={`${e.replace('_', ' ')} · ${all.filter((h) => h.exchange === e).length}`}
            selected={draft.exchanges.includes(e)}
            onPress={() => set({ exchanges: toggle(draft.exchanges, e) })}
          />
        ))}
      </View>

      <Text style={styles.section}>3. SECTOR</Text>
      <View style={styles.box}>
        {sectors.map((g) => (
          <CheckRow
            key={g.sector}
            title={g.sector}
            subtitle={g.holdings.map((h) => h.symbol).join(', ')}
            right={`${formatPct(g.weightPct)} · ${g.holdings.length}`}
            checked={draft.sectors.length === 0 || draft.sectors.includes(g.sector)}
            onPress={() => {
              // Empty = all; unticking from "all" keeps every other sector.
              const base = draft.sectors.length === 0 ? sectors.map((s) => s.sector) : draft.sectors;
              const next = toggle(base, g.sector);
              set({ sectors: next.length === sectors.length ? [] : next });
            }}
          />
        ))}
      </View>

      <Text style={styles.section}>4. PERFORMANCE</Text>
      <View style={styles.chips}>
        {LABEL_CHIPS.map((c) => (
          <Chip
            key={c.value}
            label={c.label}
            selected={draft.performance.includes(c.value)}
            onPress={() => set({ performance: toggle(draft.performance, c.value) })}
          />
        ))}
      </View>
      <Text style={styles.section}>HEALTH</Text>
      <View style={styles.chips}>
        {LABEL_CHIPS.map((c) => (
          <Chip
            key={c.value}
            label={c.value === 'NONE' ? 'Insufficient' : c.label}
            selected={draft.health.includes(c.value)}
            onPress={() => set({ health: toggle(draft.health, c.value) })}
          />
        ))}
      </View>
      <Text style={styles.hint}>
        Ratings appear once analysis is added; until then every stock is “Not rated”.
      </Text>

      <Text style={styles.section}>5. PLATFORM</Text>
      <View style={styles.box}>
        {platforms.map((p) => (
          <CheckRow
            key={p.name}
            title={p.name}
            subtitle={`${p.holdings.size} ${p.holdings.size === 1 ? 'holding' : 'holdings'}`}
            checked={
              draft.platforms.length === 0 ||
              draft.platforms.some((x) => normalisePlatform(x) === normalisePlatform(p.name))
            }
            onPress={() => {
              const base = draft.platforms.length === 0 ? platforms.map((x) => x.name) : draft.platforms;
              const has = base.some((x) => normalisePlatform(x) === normalisePlatform(p.name));
              const next = has
                ? base.filter((x) => normalisePlatform(x) !== normalisePlatform(p.name))
                : [...base, p.name];
              set({ platforms: next.length === platforms.length ? [] : next });
            }}
          />
        ))}
      </View>

      <Text style={styles.section}>6. SORT BY</Text>
      <View style={styles.chips}>
        {SORTS.map((s) => (
          <Chip
            key={s.value}
            label={s.label}
            selected={draft.sort === s.value}
            onPress={() => set({ sort: s.value })}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.sub}>{`${matched} of ${all.length} matched`}</Text>
        <Button
          label="Apply filters"
          onPress={() => {
            uiStore.getState().setPortfolioFilters(draft);
            router.back();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.headlineMd, color: colors.textPrimary },
  sub: { ...typography.labelMd, color: colors.textSecondary },
  hint: { ...typography.labelSm, color: colors.textMuted },
  section: { ...typography.labelSm, color: colors.textSecondary, marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  matchCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  matchCount: { ...typography.metricLg, color: colors.gain },
  box: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
    paddingHorizontal: spacing.md,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH + 8,
    paddingVertical: spacing.sm,
  },
  rowTitle: { ...typography.bodyMd, color: colors.textPrimary },
  rowRight: { ...typography.labelMd, color: colors.textSecondary },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.md,
  },
});
