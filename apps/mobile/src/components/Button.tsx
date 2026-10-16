import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, MIN_TOUCH, radii, spacing, typography } from '@/theme/tokens';

/** Button props. */
export type ButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: 'primary' | 'secondary' | 'destructive' | 'link';
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly accessibilityLabel?: string;
};

/** Obsidian button (DESIGN.md "Buttons"): primary fill, secondary outline, destructive outline, text link. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
  accessibilityLabel,
}: ButtonProps): React.JSX.Element {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        variant === 'primary' && pressed && styles.primaryPressed,
        variant !== 'primary' && pressed && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onGain : colors.textPrimary} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text style={[styles.label, labelStyles[variant]]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  primary: { backgroundColor: colors.gain, minHeight: 48 },
  primaryPressed: { backgroundColor: colors.gainPressed },
  secondary: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, minHeight: 48 },
  destructive: { borderWidth: 1, borderColor: colors.destructiveBorder },
  link: { paddingHorizontal: spacing.xs },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  label: { ...typography.bodyLg, fontFamily: typography.metricMd.fontFamily },
});

const labelStyles = StyleSheet.create({
  primary: { color: colors.onGain, fontSize: 16 },
  secondary: { color: colors.textPrimary },
  destructive: { color: colors.loss },
  link: { color: colors.gain },
});
