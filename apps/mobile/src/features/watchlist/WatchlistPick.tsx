import { MaterialCommunityIcons } from '@expo/vector-icons';
import { parseInstrumentKey, toInstrumentKey, type InstrumentKey, type Market } from '@portfolio/core';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ExchangeBadge, SymbolTile } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { TextField } from '@/components/TextField';
import { userMessage } from '@/lib/messages';
import { getInstrumentIndex } from '@/services/instruments/instrumentIndex';
import { instrumentStore, toastStore, useInstruments, useWatchlists, watchlistStore } from '@/stores';
import { MIN_TOUCH, radii, spacing, typography } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/theme';
import { useListsContaining } from './hooks';

const SEARCH_DEBOUNCE_MS = 150;
const MARKETS: readonly { label: string; value: Market | null }[] = [
  { label: 'All', value: null },
  { label: 'US', value: 'US' },
  { label: 'India', value: 'IN' },
];

function SearchStep({ onPick }: { readonly onPick: (key: InstrumentKey) => void }): React.JSX.Element {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [market, setMarket] = useState<Market | null>(null);
  const status = useInstruments((s) => s.status);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);
  const hits = useMemo(
    () =>
      debounced && status === 'ready'
        ? instrumentStore.getState().search(debounced, market ?? undefined)
        : [],
    [debounced, market, status],
  );

  return (
    <View style={styles.wrap}>
      <TextField
        label="Search"
        icon="magnify"
        value={query}
        onChangeText={setQuery}
        autoFocus
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="Ticker or company (e.g. NVDA, RELIANCE)"
      />
      <View style={styles.chips}>
        {MARKETS.map((m) => (
          <Chip
            key={m.label}
            label={m.label}
            selected={market === m.value}
            onPress={() => setMarket(m.value)}
          />
        ))}
      </View>
      {status !== 'ready' ? <Text style={styles.muted}>Downloading stock list…</Text> : null}
      {debounced && status === 'ready' && hits.length === 0 ? (
        <Text style={styles.muted}>{`No stocks match “${debounced}”.`}</Text>
      ) : null}
      {hits.map(({ instrument, listing }) => {
        const key = toInstrumentKey(listing.exchange, listing.symbol);
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`${listing.symbol}, ${instrument.name}, ${listing.exchange}. Choose`}
            onPress={() => onPick(key)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.flex}>
              <Text style={styles.symbol}>{listing.symbol}</Text>
              <Text style={styles.muted} numberOfLines={1}>
                {instrument.name}
              </Text>
            </View>
            <ExchangeBadge exchange={listing.exchange} />
          </Pressable>
        );
      })}
    </View>
  );
}

function ListsStep({ instrumentKey }: { readonly instrumentKey: InstrumentKey }): React.JSX.Element | null {
  const { colors } = useTheme();
  const styles = useStyles();
  const watchlists = useWatchlists((s) => s.watchlists);
  const itemsByList = useWatchlists((s) => s.itemsByList);
  const activeId = useWatchlists((s) => s.activeListId);
  const containing = useListsContaining(instrumentKey);
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(containing.length > 0 ? containing : activeId ? [activeId] : []),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseInstrumentKey(instrumentKey);
  if (!parsed) return null;
  const name = getInstrumentIndex()?.byKey.get(instrumentKey)?.instrument.name ?? parsed.symbol;

  const toggle = (id: string): void =>
    setChecked((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    const ok = await watchlistStore.getState().setMembership(parsed, [...checked]);
    setSaving(false);
    if (!ok) {
      const code = watchlistStore.getState().error;
      setError((code && userMessage(code)) ?? 'Couldn’t update your lists.');
      watchlistStore.getState().clearError();
      return;
    }
    const names = watchlists.filter((l) => checked.has(l.id)).map((l) => l.name);
    toastStore
      .getState()
      .show(
        names.length > 0
          ? `${parsed.symbol} is on ${names.join(', ')}`
          : `${parsed.symbol} removed from your lists`,
      );
    router.back();
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <SymbolTile symbol={parsed.symbol} />
        <View style={styles.flex}>
          <View style={styles.inline}>
            <Text style={styles.symbol}>{parsed.symbol}</Text>
            <ExchangeBadge exchange={parsed.exchange} />
          </View>
          <Text style={styles.muted} numberOfLines={1}>
            {name}
          </Text>
        </View>
      </View>
      <Text style={styles.section}>ON THESE WATCHLISTS</Text>
      {watchlists.map((l) => {
        const on = checked.has(l.id);
        return (
          <Pressable
            key={l.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${l.name}, ${itemsByList[l.id]?.length ?? 0} stocks`}
            onPress={() => toggle(l.id)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons
              name={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={22}
              color={on ? colors.gain : colors.textSecondary}
            />
            <Text style={[styles.flex, styles.listName]}>{l.name}</Text>
            <Text style={styles.muted}>{itemsByList[l.id]?.length ?? 0}</Text>
          </Pressable>
        );
      })}
      <Button label="New list" variant="link" onPress={() => router.push('/sheets/watchlist-edit')} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Save" onPress={() => void save()} loading={saving} />
    </View>
  );
}

/**
 * Add an instrument to one or more watchlists (LLD §4.1 `watchlist-pick`). Without `key` it
 * starts with instrument search (S07 search bar and +); with `key` (S04 ★) it shows the lists.
 */
export function WatchlistPick({
  initialKey,
}: {
  readonly initialKey: InstrumentKey | null;
}): React.JSX.Element {
  const [key, setKey] = useState<InstrumentKey | null>(initialKey);
  return key ? <ListsStep instrumentKey={key} /> : <SearchStep onPick={setKey} />;
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: spacing.md },
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    chips: { flexDirection: 'row', gap: spacing.sm },
    section: { ...typography.microBadge, color: colors.textMuted, marginTop: spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: MIN_TOUCH + 8,
      paddingHorizontal: spacing.gutter,
      paddingVertical: spacing.sm,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    pressed: { backgroundColor: colors.surface2 },
    symbol: { ...typography.metricMd, color: colors.textPrimary },
    listName: { ...typography.bodyMd, color: colors.textPrimary },
    muted: { ...typography.bodyMd, color: colors.textSecondary },
    error: { ...typography.labelMd, color: colors.loss },
  }),
);
