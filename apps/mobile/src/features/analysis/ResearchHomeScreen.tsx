import { parseInstrumentKey, toInstrumentKey, type InstrumentKey, type Market } from '@portfolio/core';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ExchangeBadge } from '@/components/Badges';
import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useHoldings } from '@/features/portfolio/hooks';
import { getInstrumentIndex } from '@/services/instruments/instrumentIndex';
import { instrumentStore, useInstruments, useUi } from '@/stores';
import { colors, MIN_TOUCH, radii, spacing, typography } from '@/theme/tokens';

const SEARCH_DEBOUNCE_MS = 150;
const MARKETS: readonly { label: string; value: Market | null }[] = [
  { label: 'All', value: null },
  { label: 'India', value: 'IN' },
  { label: 'US', value: 'US' },
];

/** Opens S04 for an instrument inside the Research tab. */
export function openResearch(key: InstrumentKey): void {
  router.push({ pathname: '/research/[key]', params: { key } });
}

function Row({
  instrumentKey,
  name,
}: {
  readonly instrumentKey: InstrumentKey;
  readonly name: string;
}): React.JSX.Element | null {
  const parsed = parseInstrumentKey(instrumentKey);
  if (!parsed) return null;
  const { exchange, symbol } = parsed;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${symbol}, ${name}, ${exchange}. Open research`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={() => openResearch(instrumentKey)}
    >
      <View style={styles.flex}>
        <Text style={styles.symbol}>{symbol}</Text>
        <Text style={styles.muted} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <ExchangeBadge exchange={exchange} />
    </Pressable>
  );
}

/** S04 start screen (LLD §4.1): instrument search, recently viewed and your holdings. */
export function ResearchHomeScreen(): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [market, setMarket] = useState<Market | null>(null);
  const status = useInstruments((s) => s.status);
  const recent = useUi((s) => s.recentResearch);
  const holdings = useHoldings();

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
  const nameOf = (key: InstrumentKey): string => getInstrumentIndex()?.byKey.get(key)?.instrument.name ?? '';

  return (
    <Screen>
      <Text style={styles.title}>Research</Text>
      <TextField
        label="Search"
        icon="magnify"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="Ticker or company (e.g. AAPL, RELIANCE)"
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

      {debounced ? (
        <View style={styles.list}>
          {hits.length === 0 && status === 'ready' ? (
            <Text style={styles.muted}>{`No stocks match “${debounced}”.`}</Text>
          ) : null}
          {hits.map(({ instrument, listing }) => {
            const key = toInstrumentKey(listing.exchange, listing.symbol);
            return <Row key={key} instrumentKey={key} name={instrument.name} />;
          })}
        </View>
      ) : (
        <>
          {recent.length > 0 ? (
            <View style={styles.list}>
              <Text style={styles.section}>RECENTLY VIEWED</Text>
              {recent.map((key) => (
                <Row key={key} instrumentKey={key} name={nameOf(key)} />
              ))}
            </View>
          ) : null}
          {holdings.length > 0 ? (
            <View style={styles.list}>
              <Text style={styles.section}>YOUR HOLDINGS</Text>
              {holdings.map((h) => (
                <Row key={h.key} instrumentKey={h.key} name={h.name} />
              ))}
            </View>
          ) : null}
          {recent.length === 0 && holdings.length === 0 ? (
            <Text style={styles.muted}>
              Search any NSE, BSE or US stock to see its Health score, fundamentals and technicals.
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.headlineMd, color: colors.textPrimary },
  chips: { flexDirection: 'row', gap: spacing.sm },
  list: { gap: spacing.sm },
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
  flex: { flex: 1 },
  symbol: { ...typography.metricMd, color: colors.textPrimary },
  muted: { ...typography.bodyMd, color: colors.textSecondary },
});
