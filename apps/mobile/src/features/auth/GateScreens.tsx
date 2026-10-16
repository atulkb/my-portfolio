import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { userMessage } from '@/lib/messages';
import { useSession } from '@/stores';
import { colors, spacing, typography } from '@/theme/tokens';

/** Shown while the profile is created/loaded after sign-in. */
export function LoadingProfileScreen(): React.JSX.Element {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.gain} size="large" />
      <Text style={styles.body}>Setting up your portfolio…</Text>
    </View>
  );
}

/** Shown when the profile could not be loaded; offers retry and sign-out. */
export function ProfileErrorScreen(): React.JSX.Element {
  const error = useSession((s) => s.error);
  const detail = useSession((s) => s.errorDetail);
  const retry = useSession((s) => s.retryProfile);
  const signOut = useSession((s) => s.signOut);
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Couldn’t load your account</Text>
      <Text style={styles.body}>{(error && userMessage(error)) || 'Something went wrong.'}</Text>
      {__DEV__ && detail ? <Text style={styles.dev}>{detail}</Text> : null}
      <Button label="Try again" onPress={() => void retry()} />
      <Button label="Sign out" variant="link" onPress={() => void signOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.margin,
    backgroundColor: colors.canvas,
  },
  title: { ...typography.headlineSm, color: colors.textPrimary },
  body: { ...typography.bodyLg, color: colors.textSecondary, textAlign: 'center' },
  dev: { ...typography.labelSm, color: colors.caution, textAlign: 'center' },
});
