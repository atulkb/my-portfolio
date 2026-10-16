import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, MIN_TOUCH, radii, spacing, typography } from '@/theme/tokens';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Labelled input (DESIGN.md "Inputs"): surface fill, hairline border, info-blue focus ring. */
export type TextFieldProps = Omit<TextInputProps, 'style' | 'secureTextEntry'> & {
  readonly label: string;
  readonly icon: IconName;
  /** Masks the value with a show/hide toggle. */
  readonly secret?: boolean;
  readonly error?: string | null;
};

/** Text input with label, leading icon, optional show/hide and inline error. */
export function TextField({
  label,
  icon,
  secret = false,
  error,
  ...input
}: TextFieldProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secret);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, focused && styles.focused, error ? styles.errorBox : null]}>
        <MaterialCommunityIcons name={icon} size={20} color={colors.textSecondary} />
        <TextInput
          {...input}
          accessibilityLabel={label}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={hidden}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={styles.input}
        />
        {secret && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            hitSlop={12}
            onPress={() => setHidden((h) => !h)}
          >
            <MaterialCommunityIcons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs + 2 },
  label: { ...typography.labelMd, color: colors.textPrimary },
  box: {
    minHeight: MIN_TOUCH + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
  },
  focused: { borderColor: colors.info },
  errorBox: { borderColor: colors.destructiveBorder },
  input: { flex: 1, ...typography.bodyLg, color: colors.textPrimary, paddingVertical: spacing.sm },
  error: { ...typography.labelSm, color: colors.loss },
});
