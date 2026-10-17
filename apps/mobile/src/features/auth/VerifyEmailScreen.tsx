import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { useSession } from '@/stores';
import { typography } from '@/theme/tokens';
import { makeStyles } from '@/theme/theme';
import { AuthHeader } from './AuthHeader';
import { ErrorText } from './ErrorText';

const RESEND_COOLDOWN_S = 60;

/** S01b Verify email (not in Stitch; Obsidian style). The profile is created only after verification. */
export function VerifyEmailScreen(): React.JSX.Element {
  const styles = useStyles();
  const email = useSession((s) => s.user?.email ?? '');
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);
  const checkVerified = useSession((s) => s.checkVerified);
  const resend = useSession((s) => s.resendVerification);
  const signOut = useSession((s) => s.signOut);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  return (
    <Screen>
      <AuthHeader
        title="Verify your email"
        subtitle={`We sent a verification link to ${email}. Open it, then come back here.`}
      />
      <ErrorText code={error} />
      <Button label="I've verified" loading={busy} onPress={() => void checkVerified()} />
      <Button
        label={cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend email'}
        variant="secondary"
        disabled={busy || cooldown > 0}
        onPress={() => void resend().then(() => setCooldown(RESEND_COOLDOWN_S))}
      />
      <Text style={styles.hint}>Can’t find it? Check your spam folder.</Text>
      <Button label="Use a different account" variant="link" onPress={() => void signOut()} />
    </Screen>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    hint: { ...typography.bodyMd, color: colors.textSecondary, textAlign: 'center' },
  }),
);
