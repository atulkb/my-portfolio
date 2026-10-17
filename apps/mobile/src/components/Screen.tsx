import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { spacing } from '@/theme/tokens';
import { makeStyles } from '@/theme/theme';

/** Scrollable, keyboard-aware screen container on the canvas background. */
export function Screen({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const styles = useStyles();
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.canvas },
    flex: { flex: 1 },
    content: { flexGrow: 1, padding: spacing.margin, paddingTop: spacing.xl, gap: spacing.lg },
  }),
);
