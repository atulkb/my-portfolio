import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useSession } from '@/stores';
import { radii, spacing, typography } from '@/theme/tokens';
import { makeStyles } from '@/theme/theme';
import { ErrorText } from './ErrorText';
import { looksLikeEmail } from './validation';

/** Forgot-password sheet on S01: sends Firebase's reset email. */
export function ForgotPasswordSheet({
  visible,
  initialEmail,
  onClose,
}: {
  readonly visible: boolean;
  readonly initialEmail: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  const styles = useStyles();
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);
  const sendPasswordReset = useSession((s) => s.sendPasswordReset);

  const close = (): void => {
    setSent(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <Text style={styles.title}>Reset password</Text>
        {sent ? (
          <Text style={styles.body}>
            If an account exists for {email.trim()}, a reset link is on its way. Check your inbox.
          </Text>
        ) : (
          <>
            <Text style={styles.body}>We’ll email you a link to choose a new password.</Text>
            <TextField
              label="Email"
              icon="email-outline"
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <ErrorText code={error} />
            <Button
              label="Send reset link"
              loading={busy}
              disabled={!looksLikeEmail(email)}
              onPress={() => void sendPasswordReset(email).then((ok) => setSent(ok))}
            />
          </>
        )}
        <Button label={sent ? 'Done' : 'Cancel'} variant="secondary" onPress={close} />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    scrim: { flex: 1, backgroundColor: colors.scrim },
    sheet: {
      backgroundColor: colors.surface2,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.margin,
      gap: spacing.md,
    },
    title: { ...typography.headlineSm, color: colors.textPrimary },
    body: { ...typography.bodyLg, color: colors.textSecondary },
  }),
);
