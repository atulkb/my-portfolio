import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing } from '@/theme/tokens';

/** Floating + button with one action (S07 add stock, S08 create rule, LLD §4.1). */
export function Fab({
  accessibilityLabel,
  onPress,
}: {
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        { bottom: insets.bottom + spacing.xl },
        pressed && { backgroundColor: colors.gainPressed },
      ]}
    >
      <MaterialCommunityIcons name="plus" size={28} color={colors.onGain} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.margin,
    width: 56,
    height: 56,
    borderRadius: radii.xl,
    backgroundColor: colors.gain,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
