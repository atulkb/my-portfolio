import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { lockStore, sessionStore } from '@/stores';
import { spacing, typography } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/theme';

/**
 * Full-screen biometric lock (LLD §4.2 `locked`): prompts at once, with a retry button and a
 * sign-out link (the device PIN is offered by the system prompt as a fallback).
 */
export function LockScreen(): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  useEffect(() => {
    void lockStore.getState().unlock();
  }, []);
  return (
    <View style={styles.wrap} accessibilityViewIsModal>
      <MaterialCommunityIcons name="lock-outline" size={48} color={colors.gain} />
      <Text style={styles.title}>Portfolio is locked</Text>
      <Text style={styles.body}>Unlock with your fingerprint, face or device PIN.</Text>
      <Button label="Unlock" onPress={() => void lockStore.getState().unlock()} />
      <Button
        label="Sign out"
        variant="link"
        onPress={() => {
          lockStore.getState().release();
          void sessionStore.getState().signOut();
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.canvas,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.lg,
      padding: spacing.xl,
    },
    title: { ...typography.headlineMd, color: colors.textPrimary },
    body: { ...typography.bodyLg, color: colors.textSecondary, textAlign: 'center' },
  }),
);
