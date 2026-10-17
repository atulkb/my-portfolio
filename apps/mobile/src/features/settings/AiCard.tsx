import { useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { FEATURES } from '@/config/features';
import { syncAi } from '@/features/analysis/ai';
import { userMessage } from '@/lib/messages';
import { getAiDevLog, subscribeAiDevLog } from '@/services/ai/devLog';
import { useAi, useSession } from '@/stores';
import { colors, radii, spacing, typography } from '@/theme/tokens';

function lastRated(ms: number | null): string {
  if (ms === null) return 'Not rated yet';
  return `Last rated ${new Date(ms).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`;
}

/**
 * S09 AI rows (LLD §4.4): "AI suggestions & buy/sell signals" toggle (hidden when the build flag
 * is off), "Refresh AI ratings now" (forced, still within the daily budget) and requests left today.
 */
export function AiCard(): React.JSX.Element {
  const enabled = useSession((s) => s.profile?.settings.aiSuggestions ?? false);
  const updateSettings = useSession((s) => s.updateSettings);
  const perf = useAi((s) => s.status.performance);
  const signals = useAi((s) => s.status.signals);
  const left = useAi((s) => s.budgetLeftToday);
  const total = useAi((s) => s.budgetTotal);
  const model = useAi((s) => s.currentModel);
  // After a restart the newest cached rating tells when holdings were last rated.
  const newestCached = useAi((s) =>
    Object.values(s.performance).reduce<number | null>(
      (m, e) => (m === null || e.createdAt > m ? e.createdAt : m),
      null,
    ),
  );
  const running = perf.running || signals.running;
  const failure = perf.failure ?? signals.failure;
  const devLog = useSyncExternalStore(subscribeAiDevLog, getAiDevLog);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>AI</Text>
        {running ? <ActivityIndicator color={colors.gain} accessibilityLabel="Rating holdings" /> : null}
      </View>
      {FEATURES.aiSuggestions ? (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.label}>AI suggestions & buy/sell signals</Text>
            <Text style={styles.sub}>
              Signal labels with AI confidence and similar stocks. Not investment advice.
            </Text>
          </View>
          <Switch
            accessibilityLabel="AI suggestions and buy/sell signals"
            value={enabled}
            onValueChange={(v) => void updateSettings({ aiSuggestions: v })}
            trackColor={{ true: colors.gain, false: colors.surface2 }}
          />
        </View>
      ) : null}
      <Text style={styles.sub}>{lastRated(perf.lastAt ?? newestCached)}</Text>
      {failure ? <Text style={styles.warn}>{userMessage(failure) ?? 'Some ratings failed.'}</Text> : null}
      <Text style={styles.sub}>
        {`AI requests left today: ${left} of ${total} · ${model ? `using ${model}` : 'all models used up until tomorrow'}`}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh AI ratings now"
        disabled={running}
        onPress={() => void syncAi(true)}
      >
        <Text style={[styles.link, running && styles.disabled]}>Refresh AI ratings now</Text>
      </Pressable>
      {__DEV__ && devLog.length > 0 ? (
        <Text style={styles.dev} selectable>
          {devLog.join('\n')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.gutter,
    gap: spacing.md,
  },
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  title: { ...typography.headlineSm, color: colors.textPrimary },
  label: { ...typography.bodyMd, color: colors.textPrimary },
  sub: { ...typography.bodyMd, color: colors.textSecondary },
  warn: { ...typography.bodyMd, color: colors.caution },
  link: { ...typography.labelMd, color: colors.info },
  disabled: { opacity: 0.5 },
  dev: { ...typography.labelSm, color: colors.textMuted, fontFamily: 'monospace' },
});
