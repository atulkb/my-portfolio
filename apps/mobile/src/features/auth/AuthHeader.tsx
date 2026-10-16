import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme/tokens';

/** Logo tile, title and subtitle at the top of S01 / S01a / S01b. */
export function AuthHeader({
  title,
  subtitle,
}: {
  readonly title: string;
  readonly subtitle: string;
}): React.JSX.Element {
  return (
    <View style={styles.wrap}>
      <View style={styles.logo} accessibilityElementsHidden>
        <MaterialCommunityIcons name="chart-line-variant" size={28} color={colors.gain} />
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

/** "OR" divider between email and Google sign-in. */
export function OrDivider(): React.JSX.Element {
  return (
    <View style={styles.divider}>
      <View style={styles.line} />
      <Text style={styles.or}>OR</Text>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  logo: {
    width: 56,
    height: 56,
    borderRadius: radii.xl,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { ...typography.headlineLg, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...typography.bodyLg, color: colors.textSecondary, textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { ...typography.microBadge, color: colors.textSecondary },
});
