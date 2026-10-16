import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Fab } from '@/components/Fab';
import { formatDate } from '@/lib/format';
import { userMessage } from '@/lib/messages';
import { rulesStore, toastStore, useRules } from '@/stores';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import {
  filterRuleCards,
  splitReadBack,
  useRuleSummary,
  type RuleCardModel,
  type RulesFilter,
} from './hooks';

const FILTERS: readonly { value: RulesFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PORTFOLIO', label: 'Portfolio' },
  { value: 'WATCHLIST', label: 'Watchlist' },
  { value: 'PAUSED', label: 'Paused' },
];

const openCreate = (): void => router.push('/sheets/create-rule');

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly accent?: string;
}): React.JSX.Element {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}. ${sub}`}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.tileSub} numberOfLines={2}>
        {sub}
      </Text>
    </View>
  );
}

function statusLine(c: RuleCardModel, lastEvaluatedAt: number | null): { text: string; color: string } {
  if (!c.valid)
    return { text: 'This rule no longer passes validation. Edit and re-test it.', color: colors.caution };
  if (!c.rule.enabled) return { text: 'Paused', color: colors.textMuted };
  if (c.matchedSymbols.length > 0) {
    const shown = c.matchedSymbols.slice(0, 4).join(', ');
    const more = c.matchedSymbols.length > 4 ? ` +${c.matchedSymbols.length - 4}` : '';
    return { text: `Triggered today (${shown}${more})`, color: colors.gain };
  }
  if (c.insufficientCount > 0)
    return { text: `No matches · insufficient data for ${c.insufficientCount}`, color: colors.caution };
  if (c.result)
    return {
      text: `No matches · last checked ${formatDate(c.result.sessionDate, { short: true })}`,
      color: colors.textSecondary,
    };
  if (lastEvaluatedAt !== null)
    return { text: `No matches · checked ${time(lastEvaluatedAt)}`, color: colors.textSecondary };
  return { text: 'Checked when the app refreshes after the close', color: colors.textSecondary };
}

function RuleCard({
  card,
  lastEvaluatedAt,
}: {
  readonly card: RuleCardModel;
  readonly lastEvaluatedAt: number | null;
}): React.JSX.Element {
  const { rule } = card;
  const status = statusLine(card, lastEvaluatedAt);
  const parts = splitReadBack(rule.readBack, rule.variables);
  const confirmDelete = (): void =>
    Alert.alert(`Delete “${rule.name}”?`, 'Its results are removed from the Rules hub.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void rulesStore.getState().remove(rule.id) },
    ]);
  return (
    <View style={[styles.card, !rule.enabled && styles.cardPaused]}>
      <View style={styles.cardTop}>
        <Text style={[styles.state, rule.enabled ? styles.stateOn : styles.stateOff]}>
          {rule.enabled ? '● ACTIVE' : '● PAUSED'}
        </Text>
        <Switch
          accessibilityLabel={`${rule.name}: ${rule.enabled ? 'active' : 'paused'}`}
          value={rule.enabled}
          onValueChange={(v) => void rulesStore.getState().toggle(rule.id, v)}
          trackColor={{ true: colors.gain, false: colors.surface2 }}
        />
        <View style={styles.flex} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${rule.name}`}
          onPress={() => router.push({ pathname: '/sheets/create-rule', params: { ruleId: rule.id } })}
          style={styles.iconBtn}
        >
          <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.textPrimary} />
          <Text style={styles.iconText}>Edit</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${rule.name}`}
          onPress={confirmDelete}
          style={styles.iconBtn}
        >
          <MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.textPrimary} />
        </Pressable>
      </View>
      <Text style={styles.name}>{rule.name}</Text>
      <Text style={styles.readBack}>
        {parts.map((p, i) =>
          p.variable ? (
            <Text key={i} style={styles.variable}>
              {p.text}
            </Text>
          ) : (
            p.text
          ),
        )}
      </Text>
      <View style={styles.cardBottom}>
        {rule.appliesToPortfolio ? <Text style={styles.tag}>Portfolio</Text> : null}
        {rule.appliesToWatchlists ? <Text style={styles.tag}>Watchlists</Text> : null}
        <Text style={[styles.status, { color: status.color }]} numberOfLines={2}>
          {status.text}
        </Text>
      </View>
    </View>
  );
}

/** S08 Rules hub (LLD §4.4). */
export function RulesScreen(): React.JSX.Element {
  const summary = useRuleSummary();
  const loadState = useRules((s) => s.loadState);
  const error = useRules((s) => s.error);
  const [filter, setFilter] = useState<RulesFilter>('ALL');
  const cards = useMemo(() => filterRuleCards(summary.cards, filter), [summary.cards, filter]);

  useEffect(() => {
    if (!error || loadState !== 'ready') return;
    const text = userMessage(error);
    if (text) toastStore.getState().show(text);
    rulesStore.getState().clearError();
  }, [error, loadState]);

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Rules Hub</Text>
        <Text style={styles.activePill}>{`${summary.active} ACTIVE`}</Text>
      </View>
      <View style={styles.tiles}>
        <Tile label="ACTIVE RULES" value={String(summary.active)} sub={`${summary.paused} paused`} />
        <Tile
          label="TRIGGERED"
          value={`${summary.triggered} today`}
          sub={summary.triggeredSymbols.slice(0, 3).join(', ') || 'No matches yet'}
          accent={summary.triggered > 0 ? colors.gain : undefined}
        />
        <Tile label="CADENCE" value="Daily close" sub="Checked when the app refreshes" />
      </View>
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <Chip
            key={f.value}
            label={`${f.label} ${summary.counts[f.value]}`}
            selected={filter === f.value}
            onPress={() => setFilter(f.value)}
          />
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.appBar}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <MaterialCommunityIcons name="tune-variant" size={20} color={colors.gain} />
          </View>
          <Text style={styles.appTitle}>RULES</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={10}
          onPress={() => router.push('/settings')}
        >
          <MaterialCommunityIcons name="cog-outline" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>

      {loadState === 'loading' && summary.cards.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.gain} />
        </View>
      ) : loadState === 'error' && summary.cards.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.body}>{(error && userMessage(error)) ?? 'Couldn’t load your rules.'}</Text>
        </View>
      ) : summary.cards.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="text-box-search-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Create your first rule</Text>
          <Text style={styles.body}>
            Describe a screen in plain English, e.g. “RSI below 30 and P/E under 20”. It runs on daily closes
            for your portfolio and watchlists.
          </Text>
          <Button label="Create rule" onPress={openCreate} />
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(c) => c.rule.id}
          ListHeaderComponent={header}
          ListEmptyComponent={<Text style={styles.body}>No rules in this filter.</Text>}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <RuleCard card={item} lastEvaluatedAt={summary.lastEvaluatedAt} />
            </View>
          )}
          ListFooterComponent={
            <Text style={styles.disclaimer}>
              Rules check daily closes when the app refreshes; there are no background alerts yet.
            </Text>
          }
        />
      )}

      <Fab accessibilityLabel="Create rule" onPress={openCreate} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.margin,
    paddingVertical: spacing.md,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appTitle: { ...typography.headlineSm, color: colors.textPrimary },
  list: { padding: spacing.margin, paddingBottom: 120 },
  headerBlock: { gap: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { ...typography.headlineMd, color: colors.textPrimary },
  activePill: {
    ...typography.microBadge,
    color: colors.gain,
    backgroundColor: colors.gainTint,
    borderWidth: 1,
    borderColor: colors.gain,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.gutter,
    gap: 2,
  },
  tileLabel: { ...typography.microBadge, color: colors.textSecondary },
  tileValue: { ...typography.metricMd, color: colors.textPrimary },
  tileSub: { ...typography.labelSm, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  item: { marginTop: spacing.md },
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardPaused: { opacity: 0.7 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  state: {
    ...typography.microBadge,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  stateOn: { color: colors.gain, backgroundColor: colors.gainTint },
  stateOff: { color: colors.textSecondary, backgroundColor: colors.surface2 },
  iconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 36,
    minWidth: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface2,
  },
  iconText: { ...typography.labelMd, color: colors.textPrimary },
  name: { ...typography.labelMd, color: colors.textSecondary },
  readBack: { ...typography.bodyLg, color: colors.textPrimary },
  variable: { color: colors.gain, fontFamily: 'monospace' },
  cardBottom: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  tag: {
    ...typography.labelSm,
    color: colors.textPrimary,
    backgroundColor: colors.canvas,
    borderRadius: radii.base,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  status: { ...typography.labelSm, flexShrink: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  emptyTitle: { ...typography.headlineSm, color: colors.textPrimary },
  body: { ...typography.bodyLg, color: colors.textSecondary, textAlign: 'center' },
  disclaimer: {
    ...typography.labelSm,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
