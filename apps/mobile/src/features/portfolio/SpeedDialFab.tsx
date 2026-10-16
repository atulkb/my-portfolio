import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing, typography } from '@/theme/tokens';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** One speed-dial entry. */
export type FabAction = { readonly label: string; readonly icon: IconName; readonly onPress: () => void };

/** Floating + button that expands into labelled actions (S02: Add stock / Upload CSV, LLD §4.1). */
export function SpeedDialFab({ actions }: { readonly actions: readonly FabAction[] }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <>
      {open ? (
        <Pressable
          accessibilityLabel="Close menu"
          style={StyleSheet.absoluteFill}
          onPress={() => setOpen(false)}
        >
          <View style={styles.scrim} />
        </Pressable>
      ) : null}
      <View style={[styles.wrap, { bottom: insets.bottom + spacing.xl }]} pointerEvents="box-none">
        {open
          ? actions.map((a) => (
              <Pressable
                key={a.label}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                style={styles.action}
                onPress={() => {
                  setOpen(false);
                  a.onPress();
                }}
              >
                <MaterialCommunityIcons name={a.icon} size={20} color={colors.gain} />
                <Text style={styles.actionText}>{a.label}</Text>
              </Pressable>
            ))
          : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? 'Close add menu' : 'Add to portfolio'}
          style={({ pressed }) => [styles.fab, pressed && { backgroundColor: colors.gainPressed }]}
          onPress={() => setOpen((o) => !o)}
        >
          <MaterialCommunityIcons name={open ? 'close' : 'plus'} size={28} color={colors.onGain} />
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim },
  wrap: { position: 'absolute', right: spacing.margin, alignItems: 'flex-end', gap: spacing.md },
  fab: {
    width: 56,
    height: 56,
    borderRadius: radii.xl,
    backgroundColor: colors.gain,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: { ...typography.labelMd, color: colors.textPrimary },
});
