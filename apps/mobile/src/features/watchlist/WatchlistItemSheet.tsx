import {
  EXCHANGE_META,
  parseInstrumentKey,
  parsePositiveNumber,
  toInstrumentKey,
  type InstrumentKey,
} from '@portfolio/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { ExchangeBadge, SymbolTile } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { TextField } from '@/components/TextField';
import { openResearch } from '@/features/analysis/ResearchHomeScreen';
import { userMessage } from '@/lib/messages';
import { getInstrumentIndex } from '@/services/instruments/instrumentIndex';
import { useWatchlists, watchlistStore } from '@/stores';
import { spacing, typography } from '@/theme/tokens';
import { makeStyles } from '@/theme/theme';
import { useListsContaining } from './hooks';

/** Notes limit (LLD §1.6). */
const MAX_NOTES = 500;

const priceText = (n: number | null): string => (n === null ? '' : String(n));

/** Empty → null; otherwise a positive number or `undefined` (invalid). */
function readPrice(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  return parsePositiveNumber(text) ?? undefined;
}

/**
 * S07 long-press / ⋮ (LLD §4.4): edit target entry/exit prices and notes, copy or move to another
 * list, remove from this list.
 */
export function WatchlistItemSheet({
  listId,
  instrumentKey,
}: {
  readonly listId: string;
  readonly instrumentKey: InstrumentKey;
}): React.JSX.Element {
  const styles = useStyles();
  const watchlists = useWatchlists((s) => s.watchlists);
  const item = useWatchlists((s) =>
    (s.itemsByList[listId] ?? []).find((i) => toInstrumentKey(i.exchange, i.symbol) === instrumentKey),
  );
  const containing = useListsContaining(instrumentKey);
  const [entry, setEntry] = useState(priceText(item?.targetEntryPrice ?? null));
  const [exit, setExit] = useState(priceText(item?.targetExitPrice ?? null));
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseInstrumentKey(instrumentKey);

  if (!item || !parsed) {
    return <Text style={styles.muted}>This stock is no longer on the list.</Text>;
  }
  const currency = EXCHANGE_META[parsed.exchange].currency;
  const symbol = currency === 'INR' ? '₹' : '$';
  const name = getInstrumentIndex()?.byKey.get(instrumentKey)?.instrument.name ?? parsed.symbol;
  const entryValue = readPrice(entry);
  const exitValue = readPrice(exit);
  const others = watchlists.filter((l) => l.id !== listId);
  const store = watchlistStore.getState;

  const failed = (fallback: string): void => {
    const code = store().error;
    setError((code && userMessage(code)) ?? fallback);
    store().clearError();
  };

  const save = async (): Promise<void> => {
    if (entryValue === undefined || exitValue === undefined) return;
    setSaving(true);
    setError(null);
    const ok = await store().updateItem(listId, instrumentKey, {
      targetEntryPrice: entryValue,
      targetExitPrice: exitValue,
      notes: notes.trim() === '' ? null : notes.trim(),
    });
    setSaving(false);
    if (ok) router.back();
    else failed('Couldn’t save the targets.');
  };

  const copyOrMove = async (toId: string, move: boolean): Promise<void> => {
    const lists = new Set(containing);
    lists.add(toId);
    if (move) lists.delete(listId);
    const ok = await store().setMembership(parsed, [...lists], {
      targetEntryPrice: item.targetEntryPrice,
      targetExitPrice: item.targetExitPrice,
      notes: item.notes,
    });
    if (ok) router.back();
    else failed(move ? 'Couldn’t move the stock.' : 'Couldn’t copy the stock.');
  };

  const confirmRemove = (): void => {
    const listName = watchlists.find((l) => l.id === listId)?.name ?? 'this list';
    Alert.alert(`Remove ${parsed.symbol} from “${listName}”?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void store()
            .removeItem(listId, instrumentKey)
            .then((ok) => (ok ? router.back() : failed('Couldn’t remove the stock.')));
        },
      },
    ]);
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

      <TextField
        label={`Target entry price (${symbol})`}
        icon="arrow-down-bold-circle-outline"
        value={entry}
        onChangeText={setEntry}
        keyboardType="decimal-pad"
        placeholder="Optional"
        error={entryValue === undefined ? 'Enter a positive number or leave empty.' : null}
      />
      <TextField
        label={`Target exit price (${symbol})`}
        icon="arrow-up-bold-circle-outline"
        value={exit}
        onChangeText={setExit}
        keyboardType="decimal-pad"
        placeholder="Optional"
        error={exitValue === undefined ? 'Enter a positive number or leave empty.' : null}
      />
      <TextField
        label="Notes"
        icon="note-text-outline"
        value={notes}
        onChangeText={setNotes}
        maxLength={MAX_NOTES}
        multiline
        placeholder="Why you are watching it (optional)"
      />
      <Text style={styles.muted}>Targets are used by watchlist rules and shown to the AI signal.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label="Save"
        onPress={() => void save()}
        loading={saving}
        disabled={entryValue === undefined || exitValue === undefined}
      />

      {others.length > 0 ? (
        <>
          <Text style={styles.section}>COPY TO</Text>
          <View style={styles.chips}>
            {others.map((l) => (
              <Chip
                key={l.id}
                label={l.name}
                selected={containing.includes(l.id)}
                disabled={containing.includes(l.id)}
                onPress={() => void copyOrMove(l.id, false)}
              />
            ))}
          </View>
          <Text style={styles.section}>MOVE TO</Text>
          <View style={styles.chips}>
            {others.map((l) => (
              <Chip key={l.id} label={l.name} selected={false} onPress={() => void copyOrMove(l.id, true)} />
            ))}
          </View>
        </>
      ) : null}

      <Button
        label="Open research"
        variant="secondary"
        onPress={() => {
          router.back();
          openResearch(instrumentKey);
        }}
      />
      <Button label="Remove from this list" variant="destructiveLink" onPress={confirmRemove} />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: spacing.md },
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    symbol: { ...typography.metricMd, color: colors.textPrimary },
    muted: { ...typography.bodyMd, color: colors.textSecondary },
    section: { ...typography.microBadge, color: colors.textMuted, marginTop: spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    error: { ...typography.labelMd, color: colors.loss },
  }),
);
