import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme/tokens';

/** Placeholder home screen until the auth gate and tabs land in M2. */
export default function HomeScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Portfolio Analyzer</Text>
      <Text style={styles.body}>M0 foundations · theme and fonts loaded</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.margin,
    backgroundColor: colors.canvas,
  },
  title: { ...typography.headlineMd, color: colors.textPrimary },
  body: { ...typography.bodyMd, color: colors.textSecondary },
});
