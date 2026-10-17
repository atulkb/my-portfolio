import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { userMessage } from '@/lib/messages';
import { useWatchlists, watchlistStore } from '@/stores';
import { MAX_WATCHLIST_NAME, watchlistNameIssue } from '@/stores/watchlistStore';
import { spacing, typography } from '@/theme/tokens';
import { makeStyles } from '@/theme/theme';

/**
 * Create, rename or delete a watchlist (LLD §4.1 `watchlist-edit`, `?id=` to edit). Names are
 * unique per user (case-insensitive); the last list can't be deleted.
 */
export function WatchlistEdit({ listId }: { readonly listId: string | null }): React.JSX.Element {
  const styles = useStyles();
  const watchlists = useWatchlists((s) => s.watchlists);
  const count = useWatchlists((s) => (listId ? (s.itemsByList[listId]?.length ?? 0) : 0));
  const list = listId ? (watchlists.find((l) => l.id === listId) ?? null) : null;
  const [name, setName] = useState(list?.name ?? '');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issue = watchlistNameIssue(name, watchlists, list?.id ?? null);

  const failed = (fallback: string): void => {
    const code = watchlistStore.getState().error;
    setError((code && userMessage(code)) ?? fallback);
    watchlistStore.getState().clearError();
  };

  const save = async (): Promise<void> => {
    setTouched(true);
    if (issue) return;
    setSaving(true);
    setError(null);
    if (list) {
      const ok = await watchlistStore.getState().rename(list.id, name);
      setSaving(false);
      if (ok) router.back();
      else failed('Couldn’t rename the list.');
      return;
    }
    const id = await watchlistStore.getState().create(name);
    setSaving(false);
    if (id) {
      watchlistStore.getState().setActive(id);
      router.back();
    } else failed('Couldn’t create the list.');
  };

  const confirmDelete = (): void => {
    if (!list) return;
    Alert.alert(
      `Delete “${list.name}”?`,
      count > 0
        ? `Its ${count} stock(s) are removed from this list. Other lists are not affected.`
        : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void watchlistStore
              .getState()
              .remove(list.id)
              .then((ok) => (ok ? router.back() : failed('Couldn’t delete the list.')));
          },
        },
      ],
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{list ? 'Edit watchlist' : 'New watchlist'}</Text>
      <TextField
        label="Name"
        icon="bookmark-outline"
        value={name}
        onChangeText={(t) => {
          setName(t);
          setTouched(true);
        }}
        maxLength={MAX_WATCHLIST_NAME}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        error={touched ? issue : null}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label={list ? 'Save' : 'Create list'} onPress={() => void save()} loading={saving} />
      {list ? (
        watchlists.length > 1 ? (
          <Button label="Delete list" variant="destructiveLink" onPress={confirmDelete} />
        ) : (
          <Text style={styles.muted}>This is your only list, so it can’t be deleted. Rename it instead.</Text>
        )
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: spacing.lg },
    title: { ...typography.headlineSm, color: colors.textPrimary },
    muted: { ...typography.bodyMd, color: colors.textSecondary },
    error: { ...typography.labelMd, color: colors.loss },
  }),
);
