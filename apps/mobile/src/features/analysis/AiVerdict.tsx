import { MaterialCommunityIcons } from '@expo/vector-icons';
import { toInstrumentKey, type DeepAnalysis, type MarketSentiment, type Signal } from '@portfolio/core';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { SignalBadge } from '@/components/Badges';
import { userMessage } from '@/lib/messages';
import { getInstrumentIndex } from '@/services/instruments/instrumentIndex';
import type { AiEntry } from '@/services/ai/aiService';
import type { AiLoad } from '@/stores/aiStore';
import { radii, spacing, typography } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/theme';
import { PARAM_LABEL } from './params';
import { openResearch } from './ResearchHomeScreen';

/** "16 Oct, 16:05" for AI timestamps. */
function generatedAt(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Error text for a failed AI run (⚪ "Analysis unavailable" for invalid output, LLD §5.2). */
function failureText(load: AiLoad | null): string {
  if (!load?.failure || load.failure === 'AI_INVALID_OUTPUT')
    return 'Analysis unavailable. Tap refresh to try again.';
  return userMessage(load.failure) ?? 'Analysis unavailable.';
}

/**
 * S04 "AI Synthesis & Outlook" card (LLD §4.4 AI Verdict): the narrative, pros/cons tied to
 * parameters, risks and what to watch; signal chip when AI suggestions are on; refresh icon.
 */
export function AiVerdictCard({
  entry,
  load,
  signal,
  canRefresh,
  onRefresh,
}: {
  readonly entry: AiEntry<DeepAnalysis> | null;
  readonly load: AiLoad | null;
  /** `null` when AI suggestions are off or no signal exists. */
  readonly signal: Signal | null;
  readonly canRefresh: boolean;
  readonly onRefresh: () => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  const loading = load?.state === 'loading';
  const a = entry?.value ?? null;
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={styles.row}>
          <MaterialCommunityIcons name="creation" size={18} color={colors.gain} />
          <Text style={styles.cardTitle}>AI Synthesis & Outlook</Text>
        </View>
        {loading ? (
          <ActivityIndicator color={colors.gain} accessibilityLabel="Generating analysis" />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Regenerate AI analysis"
            hitSlop={10}
            disabled={!canRefresh}
            onPress={onRefresh}
          >
            <MaterialCommunityIcons
              name="refresh"
              size={20}
              color={canRefresh ? colors.textSecondary : colors.textMuted}
            />
          </Pressable>
        )}
      </View>
      {signal ? <SignalBadge label={signal.label} confidencePct={signal.confidencePct} /> : null}
      {signal ? <Text style={styles.muted}>{signal.reason}</Text> : null}
      {a ? (
        <>
          <Text style={styles.body}>{a.summary}</Text>
          {a.pros.map((p) => (
            <Text key={`p-${p.paramKey}`} style={styles.bullet}>
              <Text style={{ color: colors.gain }}>{`▲ ${PARAM_LABEL[p.paramKey]}: `}</Text>
              {p.text}
            </Text>
          ))}
          {a.cons.map((c) => (
            <Text key={`c-${c.paramKey}`} style={styles.bullet}>
              <Text style={{ color: colors.loss }}>{`▼ ${PARAM_LABEL[c.paramKey]}: `}</Text>
              {c.text}
            </Text>
          ))}
          {a.risks.length > 0 ? <Text style={styles.caption}>KEY RISKS</Text> : null}
          {a.risks.map((r) => (
            <Text key={r} style={styles.bullet}>{`⚠ ${r}`}</Text>
          ))}
          {a.watchFor.length > 0 ? <Text style={styles.caption}>WATCH FOR</Text> : null}
          {a.watchFor.map((w) => (
            <Text key={w} style={styles.bullet}>{`• ${w}`}</Text>
          ))}
          {entry ? (
            <Text
              style={styles.meta}
            >{`Generated ${generatedAt(entry.createdAt)} · ${entry.model} · AI can be wrong`}</Text>
          ) : null}
          {load?.state === 'error' ? <Text style={styles.warn}>{failureText(load)}</Text> : null}
        </>
      ) : loading ? (
        <Text style={styles.muted}>Writing the analysis…</Text>
      ) : load?.state === 'error' ? (
        <Text style={styles.muted}>{`⚪ ${failureText(load)}`}</Text>
      ) : (
        <Text style={styles.muted}>The AI summary appears once prices and fundamentals are loaded.</Text>
      )}
    </View>
  );
}

/** AI-proposed comparable stocks (only with AI suggestions on; each exists in the stock list). */
export function AlternativesCard({
  analysis,
}: {
  readonly analysis: DeepAnalysis;
}): React.JSX.Element | null {
  const { colors } = useTheme();
  const styles = useStyles();
  if (analysis.alternatives.length === 0) return null;
  const index = getInstrumentIndex();
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Similar alternatives</Text>
      {analysis.alternatives.map((alt) => {
        const key = toInstrumentKey(alt.exchange, alt.symbol);
        const name = index?.byKey.get(key)?.instrument.name ?? alt.symbol;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`Open research for ${name}`}
            onPress={() => openResearch(key)}
            style={({ pressed }) => [styles.alt, pressed && styles.pressed]}
          >
            <View style={styles.flex}>
              <Text style={styles.altSymbol}>{`${alt.symbol} · ${alt.exchange}`}</Text>
              <Text style={styles.muted} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.body}>{alt.reason}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
          </Pressable>
        );
      })}
      <Text style={styles.meta}>Suggested by AI for comparison only — not a recommendation.</Text>
    </View>
  );
}

/** AI market note above the deterministic macro figures (HLD D34); hidden when unavailable. */
export function MarketNote({
  entry,
}: {
  readonly entry: AiEntry<MarketSentiment> | null;
}): React.JSX.Element | null {
  const styles = useStyles();
  if (!entry) return null;
  return (
    <View style={styles.note}>
      <Text style={styles.noteHeadline}>{entry.value.headline}</Text>
      <Text style={styles.body}>{entry.value.paragraph}</Text>
      <Text style={styles.meta}>{`AI summary · ${generatedAt(entry.createdAt)}`}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    flex: { flex: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    card: {
      backgroundColor: colors.surface1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.xl,
      padding: spacing.lg,
      gap: spacing.md,
    },
    cardTitle: { ...typography.headlineSm, color: colors.textPrimary },
    body: { ...typography.bodyMd, color: colors.textPrimary },
    bullet: { ...typography.bodyMd, color: colors.textPrimary },
    muted: { ...typography.bodyMd, color: colors.textSecondary },
    caption: { ...typography.microBadge, color: colors.textMuted },
    meta: { ...typography.labelSm, color: colors.textMuted },
    warn: { ...typography.labelSm, color: colors.caution },
    alt: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    altSymbol: { ...typography.labelMd, color: colors.textPrimary },
    pressed: { opacity: 0.7 },
    note: {
      gap: spacing.xs,
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    noteHeadline: { ...typography.labelMd, color: colors.textPrimary },
  }),
);
