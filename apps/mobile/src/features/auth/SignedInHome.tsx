import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useSession } from '@/stores';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { StockListCard } from '@/features/instruments/StockListCard';
import { AuthHeader } from './AuthHeader';

/** M2 placeholder: confirms sign-in and profile creation until the Portfolio tab exists. */
export function SignedInHome(): React.JSX.Element {
  const profile = useSession((s) => s.profile);
  const busy = useSession((s) => s.busy);
  const signOut = useSession((s) => s.signOut);
  return (
    <Screen>
      <AuthHeader
        title={`Hi, ${profile?.displayName ?? 'there'}`}
        subtitle="You're signed in. Your portfolio arrives in the next milestones."
      />
      <View style={styles.card}>
        <Row label="Email" value={profile?.email ?? '—'} />
        <Row label="Signed in with" value={profile?.authProvider === 'google' ? 'Google' : 'Email'} />
        <Row label="Summary currency" value={profile?.settings.summaryCurrency ?? '—'} />
      </View>
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
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.gutter,
    gap: spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { ...typography.bodyMd, color: colors.textSecondary },
  value: { ...typography.bodyMd, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
});
