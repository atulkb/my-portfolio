import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toastStore, useToast } from '@/stores';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** Clears the floating + button (56 dp + margins) so toast actions stay tappable. */
const TOAST_OFFSET = 96;

/** Renders the current toast above the bottom edge; auto-dismisses after its duration. */
export function ToastHost(): React.JSX.Element | null {
  const toast = useToast((s) => s.current);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => toastStore.getState().dismiss(toast.id), toast.durationMs);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + TOAST_OFFSET }]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.toast}>
        <Text style={styles.text}>{toast.message}</Text>
        {toast.actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            hitSlop={12}
            onPress={() => {
              toastStore.getState().dismiss(toast.id);
              action.onPress();
            }}
          >
            <Text style={styles.action}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.margin, right: spacing.margin },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  text: { ...typography.bodyMd, color: colors.textPrimary, flex: 1 },
  action: { ...typography.labelMd, color: colors.gain },
});
