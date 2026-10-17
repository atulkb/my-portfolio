import type { AppErrorCode } from '@portfolio/core';
import { StyleSheet, Text } from 'react-native';

import { userMessage } from '@/lib/messages';
import { typography } from '@/theme/tokens';
import { makeStyles } from '@/theme/theme';

/** Inline error from the catalogue (LLD §5.2); renders nothing for silent codes. */
export function ErrorText({ code }: { readonly code: AppErrorCode | null }): React.JSX.Element | null {
  const styles = useStyles();
  const message = code ? userMessage(code) : null;
  if (!message) return null;
  return (
    <Text style={styles.text} accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({ text: { ...typography.bodyMd, color: colors.loss, textAlign: 'center' } }),
);
