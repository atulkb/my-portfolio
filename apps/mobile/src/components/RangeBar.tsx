import { StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography } from '@/theme/tokens';
import { makeStyles } from '@/theme/theme';

/** Low–high range with the current value marked (S04 day range, 52-week range). */
export function RangeBar({
  title,
  low,
  high,
  value,
  lowLabel,
  highLabel,
}: {
  readonly title: string;
  readonly low: number | null;
  readonly high: number | null;
  readonly value: number | null;
  /** Formatted low ("Day low ₹1,193.00"). */
  readonly lowLabel: string;
  readonly highLabel: string;
}): React.JSX.Element {
  const styles = useStyles();
  const known = low !== null && high !== null && value !== null && high > low;
  const pos = known ? Math.min(1, Math.max(0, (value - low) / (high - low))) : null;
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`${title}: ${lowLabel} to ${highLabel}`}>
      <View style={styles.labels}>
        <Text style={styles.label}>{lowLabel}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.label}>{highLabel}</Text>
      </View>
      <View style={styles.track}>
        {pos !== null ? <View style={[styles.fill, { width: `${pos * 100}%` }]} /> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: spacing.xs },
    labels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
    label: { ...typography.labelSm, color: colors.textSecondary },
    title: { ...typography.microBadge, color: colors.textMuted },
    track: { height: 6, borderRadius: radii.full, backgroundColor: colors.surface2, overflow: 'hidden' },
    fill: { height: 6, borderRadius: radii.full, backgroundColor: colors.gain },
  }),
);
