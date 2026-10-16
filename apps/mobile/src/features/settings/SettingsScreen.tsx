import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { undoImportWithToast } from '@/features/portfolio/csvImport';
import { usePortfolio, useSession } from '@/stores';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { MarketDataCard } from './MarketDataCard';
import { StockListCard } from './StockListCard';

/**
 * S09 Settings, interim (M4): account, stock list, Undo last import, sign out. The full screen
 * (currency, platforms, AI, cache, delete account) is built in M9 (LLD §4.4).
 */
export function SettingsScreen(): React.JSX.Element {
  const profile = useSession((s) => s.profile);
  const busy = useSession((s) => s.busy);
  const signOut = useSession((s) => s.signOut);
  const lastImport = usePortfolio((s) => s.lastImport);
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
        <Text style={styles.title}>Settings</Text>
      </View>
      <View style={styles.card}>
        <Row label="Name" value={profile?.displayName ?? '—'} />
        <Row label="Email" value={profile?.email ?? '—'} />
        <Row label="Signed in with" value={profile?.authProvider === 'google' ? 'Google' : 'Email'} />
        <Row
          label="Platforms"
          value={profile && profile.platforms.length > 0 ? profile.platforms.join(', ') : 'None yet'}
        />
      </View>
      {lastImport ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Data</Text>
          <Text style={styles.label}>
            {`Last import: ${lastImport.count} ${lastImport.count === 1 ? 'buy' : 'buys'} · ${new Date(lastImport.importedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
          </Text>
          <Button label="Undo last import" variant="secondary" onPress={() => void undoImportWithToast()} />
        </View>
      ) : null}
      <MarketDataCard />
      <StockListCard />
      <Button label="Sign out" variant="secondary" loading={busy} onPress={() => void signOut()} />
    </Screen>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  cardTitle: { ...typography.headlineSm, color: colors.textPrimary },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { ...typography.bodyMd, color: colors.textSecondary },
  value: { ...typography.bodyMd, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
});
