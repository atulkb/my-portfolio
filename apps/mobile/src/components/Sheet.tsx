import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '@/theme/tokens';
import { makeStyles } from '@/theme/theme';

/** Scrollable, keyboard-aware content of a sheet route (`presentation: 'formSheet'`, LLD §4.1). */
export function SheetScroll({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.flex} behavior="height">
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.canvas },
    content: { padding: spacing.margin, paddingTop: spacing.xl },
  }),
);
