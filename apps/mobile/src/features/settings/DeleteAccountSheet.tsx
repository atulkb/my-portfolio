import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { userMessage } from '@/lib/messages';
import { useOnline } from '@/services/device/network';
import { sessionStore, useSession } from '@/stores';
import { spacing, typography } from '@/theme/tokens';
import { makeStyles } from '@/theme/theme';

/** Text the user types to confirm (LLD §4.4). */
const CONFIRM_WORD = 'DELETE';

/**
 * S09 → Delete account (LLD §1.12): type DELETE; email accounts confirm with their password,
 * Google accounts sign in with Google again. Deletes everything, then signs out.
 */
export function DeleteAccountSheet(): React.JSX.Element {
  const styles = useStyles();
  const profile = useSession((s) => s.profile);
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);
  const online = useOnline();
  const [word, setWord] = useState('');
  const [password, setPassword] = useState('');
  const email = profile?.authProvider === 'password';
  const ready = word.trim() === CONFIRM_WORD && (!email || password.length > 0) && online;

  const remove = async (): Promise<void> => {
    sessionStore.getState().clearError();
    // On success the auth listener signs out and the gate leaves the signed-in screens.
    const ok = await sessionStore.getState().deleteAccount(email ? password : null);
    if (ok && router.canGoBack()) router.dismissAll();
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Delete account</Text>
      <Text style={styles.body}>
        This permanently deletes your profile, all buy transactions, watchlists, rules and rule results, and
        your sign-in. It can’t be undone.
      </Text>
      <TextField
        label={`Type ${CONFIRM_WORD} to confirm`}
        icon="alert-outline"
        value={word}
        onChangeText={setWord}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      {email ? (
        <TextField
          label="Your password"
          icon="lock-outline"
          value={password}
          onChangeText={setPassword}
          secret
          autoComplete="current-password"
        />
      ) : (
        <Text style={styles.muted}>You’ll be asked to sign in with Google again to confirm.</Text>
      )}
      {!online ? <Text style={styles.warn}>You’re offline. Deleting needs a connection.</Text> : null}
      {error ? (
        <Text style={styles.error}>{userMessage(error) ?? 'Something went wrong. Try again.'}</Text>
      ) : null}
      <Button
        label="Delete everything"
        variant="destructive"
        onPress={() => void remove()}
        disabled={!ready}
        loading={busy}
      />
      <Button label="Cancel" variant="link" onPress={() => router.back()} />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: spacing.lg },
    title: { ...typography.headlineSm, color: colors.loss },
    body: { ...typography.bodyLg, color: colors.textPrimary },
    muted: { ...typography.bodyMd, color: colors.textSecondary },
    warn: { ...typography.labelMd, color: colors.caution },
    error: { ...typography.labelMd, color: colors.loss },
  }),
);
