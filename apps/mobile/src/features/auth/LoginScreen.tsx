import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useSession } from '@/stores';
import { colors, spacing, typography } from '@/theme/tokens';
import { AuthHeader, OrDivider } from './AuthHeader';
import { ErrorText } from './ErrorText';
import { ForgotPasswordSheet } from './ForgotPasswordSheet';
import { looksLikeEmail } from './validation';

/**
 * S01 Login. Per HLD §16: email/password and Google; no biometric sign-in (biometrics only lock
 * an existing session, M9) and no "remember device" (sessions persist by default).
 */
export function LoginScreen(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);
  const signInWithEmail = useSession((s) => s.signInWithEmail);
  const signInWithGoogle = useSession((s) => s.signInWithGoogle);
  const clearError = useSession((s) => s.clearError);

  const canSubmit = looksLikeEmail(email) && password.length > 0;

  return (
    <Screen>
      <AuthHeader title="Welcome back" subtitle="Sign in to track your Indian and US holdings in one place" />
      <TextField
        label="Email"
        icon="email-outline"
        value={email}
        onChangeText={setEmail}
        placeholder="name@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
      />
      <TextField
        label="Password"
        icon="lock-outline"
        secret
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={() => canSubmit && void signInWithEmail(email, password)}
      />
      <View style={styles.forgotRow}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            clearError();
            setResetOpen(true);
          }}
        >
          <Text style={styles.link}>Forgot password?</Text>
        </Pressable>
      </View>
      <ErrorText code={error} />
      <Button
        label="Log in"
        loading={busy}
        disabled={!canSubmit}
        onPress={() => void signInWithEmail(email, password)}
        icon={<MaterialCommunityIcons name="arrow-right" size={18} color={colors.onGain} />}
      />
      <OrDivider />
      <Button
        label="Continue with Google"
        variant="secondary"
        disabled={busy}
        onPress={() => void signInWithGoogle()}
        icon={<MaterialCommunityIcons name="google" size={20} color={colors.textPrimary} />}
      />
      <View style={styles.footer}>
        <Text style={styles.muted}>Don’t have an account? </Text>
        <Link href="/sign-up" replace onPress={clearError}>
          <Text style={styles.link}>Sign up</Text>
        </Link>
      </View>
      <ForgotPasswordSheet visible={resetOpen} initialEmail={email} onClose={() => setResetOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  forgotRow: { alignItems: 'flex-end', marginTop: -spacing.sm },
  link: { ...typography.labelMd, color: colors.gain },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: spacing.sm },
  muted: { ...typography.bodyMd, color: colors.textSecondary },
});
