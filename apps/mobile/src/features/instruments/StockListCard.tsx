import type { Market, SearchHit } from '@portfolio/core';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { TextField } from '@/components/TextField';
import { userMessage } from '@/lib/messages';
import { instrumentStore, useInstruments } from '@/stores';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const MARKETS: readonly (Market | null)[] = [null, 'IN', 'US'];

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * M3 check: stock-list status ("18,108 stocks · updated …", LLD §4.4 Settings row) and a search
 * box over the local list. Moves into Settings / ticker search with M4–M5.
 */
export function StockListCard(): React.JSX.Element {
  const status = useInstruments((s) => s.status);
  const meta = useInstruments((s) => s.meta);
  const error = useInstruments((s) => s.error);
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState<Market | null>(null);

  const [{ hits, ms }, setResult] = useState<{ hits: SearchHit[]; ms: number }>({ hits: [], ms: 0 });
  const latest = useRef({ query, market });

  function run(q: string, m: Market | null): void {
    latest.current = { query: q, market: m };
    const t0 = performance.now();
    const found = instrumentStore.getState().search(q, m ?? undefined);
    setResult({ hits: found, ms: performance.now() - t0 });
  }

  // Re-run the current query when the list finishes loading or updates.
  useEffect(
    () =>
      instrumentStore.subscribe((s, prev) => {
        if (s.meta !== prev.meta) run(latest.current.query, latest.current.market);
      }),
    [],
  );

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>Stock list</Text>
        {status === 'downloading' ? <ActivityIndicator color={colors.gain} /> : null}
      </View>
      <Text style={styles.sub}>
        {meta
          ? `${meta.counts.total.toLocaleString('en-IN')} stocks · updated ${formatDate(meta.generatedAt)}`
          : status === 'downloading'
            ? 'Downloading stock list…'
            : 'Not downloaded yet'}
      </Text>
      {error ? <Text style={styles.error}>{userMessage(error)}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Check for stock list update"
        onPress={() => void instrumentStore.getState().ensureFresh({ force: true })}
      >
        <Text style={styles.link}>Check for update</Text>
      </Pressable>

      <TextField
        label="Search stocks"
        icon="magnify"
        value={query}
        onChangeText={(q) => {
          setQuery(q);
          run(q, market);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="RELIANCE, Apple, INFY…"
      />
      <View style={styles.chips}>
        {MARKETS.map((m) => (
          <Pressable
            key={m ?? 'ALL'}
            accessibilityRole="button"
            accessibilityLabel={`Market filter ${m ?? 'All'}`}
            onPress={() => {
              setMarket(m);
              run(query, m);
            }}
            style={[styles.chip, market === m && styles.chipOn]}
          >
            <Text style={[styles.chipText, market === m && styles.chipTextOn]}>{m ?? 'All'}</Text>
          </Pressable>
        ))}
        {__DEV__ && query ? <Text style={styles.sub}>{`${hits.length} · ${ms.toFixed(1)} ms`}</Text> : null}
      </View>
      {hits.slice(0, 8).map(({ instrument, listing }) => (
        <View key={`${listing.exchange}:${listing.symbol}`} style={styles.hit}>
          <View style={styles.hitMain}>
            <Text style={styles.symbol}>{listing.symbol}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {instrument.name}
            </Text>
          </View>
          <Text style={styles.exchange}>{listing.exchange.replace('_', ' ')}</Text>
        </View>
      ))}
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
  error: { ...typography.bodyMd, color: colors.caution },
  link: { ...typography.labelMd, color: colors.info },
  chips: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.surface2, borderColor: colors.gain },
  chipText: { ...typography.labelMd, color: colors.textSecondary },
  chipTextOn: { color: colors.textPrimary },
  hit: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  hitMain: { flex: 1 },
  symbol: { ...typography.bodyLg, color: colors.textPrimary },
  name: { ...typography.labelMd, color: colors.textSecondary },
  exchange: { ...typography.labelSm, color: colors.textMuted },
});
