import { StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDate } from '@/lib/format';
import { userMessage } from '@/lib/messages';
import { useOnline } from '@/services/device/network';
import { useMarket } from '@/stores';
import { radii, spacing, typography } from '@/theme/tokens';
import { makeStyles } from '@/theme/theme';

/** Height of the bottom tab bar the banner sits above. */
const TAB_BAR = 64;

/** "Offline · showing data as of 15 Oct" (LLD §4.6), above the tab bar while offline. */
export function OfflineBanner(): React.JSX.Element | null {
  const styles = useStyles();
  const online = useOnline();
  const insets = useSafeAreaInsets();
  const latest = useMarket((s) => {
    let max: string | null = null;
    for (const snap of s.snapshots.values())
      if (max === null || snap.sessionDate > max) max = snap.sessionDate;
    return max;
  });
  if (online) return null;
  const text = latest
    ? (userMessage('APP_OFFLINE', { date: formatDate(latest, { short: true }) }) ?? 'Offline')
    : 'Offline · changes will sync when you are back online';
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[styles.banner, { bottom: insets.bottom + TAB_BAR + spacing.sm }]}
    >
      {text}
    </Text>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    banner: {
      position: 'absolute',
      left: spacing.margin,
      right: spacing.margin,
      ...typography.labelMd,
      color: colors.caution,
      backgroundColor: colors.surface2,
      borderWidth: 1,
      borderColor: colors.caution,
      borderRadius: radii.lg,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      overflow: 'hidden',
      textAlign: 'center',
    },
  }),
);
