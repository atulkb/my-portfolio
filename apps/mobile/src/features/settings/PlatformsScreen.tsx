import { MaterialCommunityIcons } from '@expo/vector-icons';
import { normalisePlatform } from '@portfolio/core';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { userMessage } from '@/lib/messages';
import { portfolioStore, sessionStore, toastStore, usePortfolio, useSession } from '@/stores';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** Platform name limit (matches the transaction schema). */
const MAX_NAME = 40;

/** Why a new platform name can't be used, or null. */
export function platformNameIssue(
  name: string,
  platforms: readonly string[],
  current: string,
): string | null {
  const n = name.trim();
  if (n.length === 0) return 'Enter a name.';
  if (n.length > MAX_NAME) return `Use at most ${MAX_NAME} characters.`;
  const taken = platforms.some(
    (p) =>
      normalisePlatform(p) === normalisePlatform(n) && normalisePlatform(p) !== normalisePlatform(current),
  );
  return taken ? 'You already have a platform with this name.' : null;
}

function PlatformRow({
  name,
  holdings,
  platforms,
}: {
  readonly name: string;
  readonly holdings: number;
  readonly platforms: readonly string[];
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const issue = platformNameIssue(value, platforms, name);

  const rename = async (): Promise<void> => {
    if (issue) return;
    const to = value.trim();
    setSaving(true);
    // Buys first (the source of truth), then the managed list.
    const ok = await portfolioStore.getState().renamePlatform(name, to);
    const listOk =
      ok &&
      (await sessionStore
        .getState()
        .setPlatforms(platforms.map((p) => (normalisePlatform(p) === normalisePlatform(name) ? to : p))));
    setSaving(false);
    if (ok && listOk) {
      setEditing(false);
      toastStore.getState().show(`Renamed to ${to}`);
    } else {
      const code = portfolioStore.getState().error ?? sessionStore.getState().error;
      toastStore.getState().show((code && userMessage(code)) ?? 'Couldn’t rename the platform.');
    }
  };

  const remove = (): void =>
    Alert.alert(`Remove “${name}”?`, 'It is no longer used by any buy.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void sessionStore
            .getState()
            .setPlatforms(platforms.filter((p) => normalisePlatform(p) !== normalisePlatform(name))),
      },
    ]);

  if (editing) {
    return (
      <View style={styles.card}>
        <TextField
          label="Platform name"
          icon="bank-outline"
          value={value}
          onChangeText={setValue}
          maxLength={MAX_NAME}
          autoFocus
          error={issue}
        />
        <View style={styles.actions}>
          <Button label="Cancel" variant="link" onPress={() => setEditing(false)} />
          <Button
            label="Rename"
            onPress={() => void rename()}
            loading={saving}
            disabled={!!issue || value.trim() === name}
          />
        </View>
        {holdings > 0 ? (
          <Text style={styles.sub}>{`Updates the platform on all buys of ${holdings} stock(s).`}</Text>
        ) : null}
      </View>
    );
  }
  return (
    <View style={[styles.card, styles.row]}>
      <View style={styles.flex}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.sub}>{holdings > 0 ? `${holdings} holding(s)` : 'Not used'}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Rename ${name}`}
        hitSlop={8}
        onPress={() => {
          setValue(name);
          setEditing(true);
        }}
        style={styles.icon}
      >
        <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.textPrimary} />
      </Pressable>
      {holdings === 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name}`}
          hitSlop={8}
          onPress={remove}
          style={styles.icon}
        >
          <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.loss} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** S09 → Platforms (LLD §4.1): rename (rewrites every buy) or remove unused broker names. */
export function PlatformsScreen(): React.JSX.Element {
  const platforms = useSession((s) => s.profile?.platforms ?? []);
  const transactions = usePortfolio((s) => s.transactions);
  const counts = useMemo(() => {
    const byPlatform = new Map<string, Set<string>>();
    for (const t of transactions) {
      const k = normalisePlatform(t.platform);
      const set = byPlatform.get(k) ?? new Set<string>();
      set.add(`${t.exchange}:${t.symbol}`);
      byPlatform.set(k, set);
    }
    return byPlatform;
  }, [transactions]);

  return (
    <Screen>
      <View style={styles.appBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={() => router.back()}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>Platforms</Text>
      </View>
      <Text style={styles.sub}>
        Broker names come from your buys and CSV uploads. Renaming updates every buy; a platform can be
        removed once no buy uses it.
      </Text>
      {platforms.length === 0 ? <Text style={styles.sub}>No platforms yet.</Text> : null}
      {platforms.map((p) => (
        <PlatformRow
          key={p}
          name={p}
          holdings={counts.get(normalisePlatform(p))?.size ?? 0}
          platforms={platforms}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  appBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { ...typography.headlineMd, color: colors.textPrimary },
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.gutter,
    gap: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  icon: { padding: spacing.sm },
  name: { ...typography.bodyLg, color: colors.textPrimary },
  sub: { ...typography.labelMd, color: colors.textSecondary },
});
