import { Pressable, StyleSheet, Text } from 'react-native';

import { MIN_TOUCH, radii, spacing, typography } from '@/theme/tokens';
import { makeStyles } from '@/theme/theme';

/** Selectable pill (market toggle, filters, platform picker). */
export function Chip({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}): React.JSX.Element {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: (MIN_TOUCH - 32) / 2, bottom: (MIN_TOUCH - 32) / 2 }}
      style={[styles.chip, selected && styles.on, disabled && styles.disabled]}
    >
      <Text style={[styles.text, selected && styles.textOn]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    chip: {
      minHeight: 32,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: radii.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    on: { backgroundColor: colors.gainTint, borderColor: colors.gain },
    disabled: { opacity: 0.4 },
    text: { ...typography.labelMd, color: colors.textSecondary },
    textOn: { color: colors.gain },
  }),
);
