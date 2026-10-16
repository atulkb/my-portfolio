import type { AppErrorCode } from '@portfolio/core';
import { StyleSheet, Text } from 'react-native';

import { userMessage } from '@/lib/messages';
import { colors, typography } from '@/theme/tokens';

/** Inline error from the catalogue (LLD §5.2); renders nothing for silent codes. */
export function ErrorText({ code }: { readonly code: AppErrorCode | null }): React.JSX.Element | null {
  const message = code ? userMessage(code) : null;
  if (!message) return null;
  return (
    <Text style={styles.text} accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({ text: { ...typography.bodyMd, color: colors.loss, textAlign: 'center' } });
