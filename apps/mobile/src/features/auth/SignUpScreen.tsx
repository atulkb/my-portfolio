import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { useSession } from '@/stores';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { AuthHeader, OrDivider } from './AuthHeader';
import { ErrorText } from './ErrorText';
import { isStrongPassword, looksLikeEmail, passwordChecks } from './validation';

function Check({ ok, label }: { readonly ok: boolean; readonly label: string }): React.JSX.Element {
  return (
    <View style={styles.check} accessibilityLabel={`${label}: ${ok ? 'met' : 'not met'}`}>
      <MaterialCommunityIcons
        name={ok ? 'check-circle' : 'checkbox-blank-circle-outline'}
        size={14}
        color={ok ? colors.gain : colors.textMuted}
      />
      <Text style={[styles.checkText, ok && styles.checkOk]}>{label}</Text>
    </View>
  );
}

/**
 * S01a Sign up. Per HLD §16: name, email, password (≥ 8 chars, 1 number, 1 symbol) or Google.
 * No biometric/passkey sign-up and no custodial or end-to-end encryption claims. The profile is
 * created only after the email is verified (S01b).
 */
export function SignUpScreen(): React.JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);
  const signUp = useSession((s) => s.signUp);
  const signInWithGoogle = useSession((s) => s.signInWithGoogle);
  const clearError = useSession((s) => s.clearError);

  const checks = passwordChecks(password);
  const strength = [checks.length, checks.number, checks.symbol].filter(Boolean).length;
  const canSubmit = name.trim().length > 0 && looksLikeEmail(email) && isStrongPassword(password);

  return (
    <Screen>
      <AuthHeader title="Create your account" subtitle="Track your multi-market portfolio in one place" />
      <TextField
        label="Full name"
        icon="account-outline"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Alex Morgan"
        autoComplete="name"
      />
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
      <TextField
        label="Password"
        icon="lock-outline"
        secret
        value={password}
        onChangeText={setPassword}
        placeholder="Choose a password"
        autoComplete="new-password"
      />
      <View style={styles.rules}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${(strength / 3) * 100}%` }]} />
        </View>
        <View style={styles.checks}>
          <Check ok={checks.length} label="8+ chars" />
          <Check ok={checks.number} label="1 number" />
          <Check ok={checks.symbol} label="1 symbol" />
        </View>
      </View>
      <ErrorText code={error} />
      <Button
        label="Create account"
        loading={busy}
        disabled={!canSubmit}
        onPress={() => void signUp(name, email, password)}
        icon={<MaterialCommunityIcons name="arrow-right" size={18} color={colors.onGain} />}
      />
      <OrDivider />
      <Button
        label="Sign up with Google"
        variant="secondary"
        disabled={busy}
        onPress={() => void signInWithGoogle()}
        icon={<MaterialCommunityIcons name="google" size={20} color={colors.textPrimary} />}
      />
      <View style={styles.footer}>
        <Text style={styles.muted}>Already have an account? </Text>
        <Link href="/login" replace onPress={clearError}>
          <Text style={styles.link}>Log in</Text>
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rules: {
    backgroundColor: colors.surface1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: -spacing.sm,
  },
  track: { height: 4, borderRadius: radii.full, backgroundColor: colors.surface2, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.gain },
  checks: { flexDirection: 'row', justifyContent: 'space-between' },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  checkText: { ...typography.labelSm, color: colors.textSecondary },
  checkOk: { color: colors.gain },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: spacing.sm },
  muted: { ...typography.bodyMd, color: colors.textSecondary },
  link: { ...typography.labelMd, color: colors.gain },
});
