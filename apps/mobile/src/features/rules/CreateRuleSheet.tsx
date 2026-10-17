import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  candidatesInScope,
  checkRuleScopes,
  dryRun,
  MAX_RULES,
  parseInstrumentKey,
  toAppError,
  type DryRunResult,
  type InstrumentKey,
  type RuleScope,
} from '@portfolio/core';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { userMessage } from '@/lib/messages';
import type { CompiledRule } from '@/services/ai/aiService';
import { useOnline } from '@/services/device/network';
import { rulesStore, useRules } from '@/stores';
import { radii, spacing, typography } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/theme';
import { splitReadBack } from './hooks';
import { currentRuleCandidates } from './sync';

/** Limits (LLD §1.7). */
const MAX_TEXT = 500;
const MAX_NAME = 60;

/** Pre-written sentences (S08a example chips). */
const EXAMPLES: readonly { label: string; text: string }[] = [
  { label: 'Oversold dip', text: 'RSI below 30 and P/E under 20' },
  {
    label: 'Breakout volume',
    text: 'Close above the 50-day moving average and volume more than twice the 30-day average',
  },
  { label: 'Low debt + yield', text: 'Debt to equity below 0.5 and dividend yield above 4%' },
  { label: 'Golden cross', text: '50-day moving average crosses above the 200-day moving average' },
  { label: 'At target entry', text: 'Close at or below my target entry price' },
];

type Scopes = { readonly appliesToPortfolio: boolean; readonly appliesToWatchlists: boolean };

/** A passed dry test: what was tested and its outcome (Save needs it to match the form). */
type Tested = {
  readonly text: string;
  readonly scopes: Scopes;
  readonly compiled: CompiledRule & { readonly result: { readonly status: 'OK' } };
  readonly dry: DryRunResult;
};

const symbolOf = (key: InstrumentKey): string => parseInstrumentKey(key)?.symbol ?? key;
const scopeText = (s: RuleScope): string => (s === 'PORTFOLIO' ? 'Portfolio' : 'Watchlist');

function ToggleRow({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: boolean;
  readonly onChange: (v: boolean) => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.gain, false: colors.surface2 }}
      />
    </View>
  );
}

function Matches({ title, items }: { readonly title: string; readonly items: DryRunResult['matches'] }) {
  const styles = useStyles();
  if (items.length === 0) return null;
  return (
    <View style={styles.matchBlock}>
      <Text style={styles.section}>{title}</Text>
      <Text style={styles.body}>
        {items.map((m) => `${symbolOf(m.key)} (${scopeText(m.scope)})`).join(', ')}
      </Text>
    </View>
  );
}

/**
 * S08a Create / edit rule (LLD §2.8, §4.4): English sentence → Gemini → whitelist validation →
 * deterministic read-back → dry run on today's data. Save is enabled only after a passing dry
 * test of the current text and scopes, and stores the read-back the user saw.
 */
export function CreateRuleSheet({ ruleId }: { readonly ruleId: string | null }): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  const existing = useRules((s) => (ruleId ? (s.rules.find((r) => r.id === ruleId) ?? null) : null));
  const existingValid = useRules((s) => (ruleId ? (s.valid.get(ruleId) ?? null) : null));
  const ruleCount = useRules((s) => s.rules.length);
  const online = useOnline();
  const [text, setText] = useState(existing?.naturalPrompt ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [scopes, setScopes] = useState<Scopes>({
    appliesToPortfolio: existing?.appliesToPortfolio ?? true,
    appliesToWatchlists: existing?.appliesToWatchlists ?? true,
  });
  const [tested, setTested] = useState<Tested | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; issues: readonly string[] } | null>(null);

  // Compiles per sentence, so changing only the scopes re-tests without another AI call. An edited
  // rule starts with its stored (re-validated) logic.
  const [compiled] = useState(() => {
    const m = new Map<string, CompiledRule>();
    if (existing && existingValid)
      m.set(existing.naturalPrompt, {
        result: {
          status: 'OK',
          rule: existingValid,
          readBack: existing.readBack,
          suggestedName: existing.name,
          scopeIssues: [],
        },
        model: existing.compiledWith.model,
        promptVersion: existing.compiledWith.promptVersion,
      });
    return m;
  });

  const trimmed = text.trim();
  const atLimit = !existing && ruleCount >= MAX_RULES;
  const noScope = !scopes.appliesToPortfolio && !scopes.appliesToWatchlists;
  const testCurrent =
    tested !== null &&
    tested.text === trimmed &&
    tested.scopes.appliesToPortfolio === scopes.appliesToPortfolio &&
    tested.scopes.appliesToWatchlists === scopes.appliesToWatchlists;
  const nameOk = name.trim().length > 0 && name.trim().length <= MAX_NAME;
  // A sentence compiled earlier can be re-tested offline; a new one needs Gemini.
  const needsNetwork = !online && !compiled.has(trimmed);
  const canSave = testCurrent && nameOk && !atLimit && !saving;

  const readBackParts = useMemo(
    () =>
      tested ? splitReadBack(tested.compiled.result.readBack, tested.compiled.result.rule.variables) : [],
    [tested],
  );

  const runDryTest = async (): Promise<void> => {
    setProblem(null);
    setTested(null);
    if (trimmed.length < 3) {
      setProblem({ message: 'Describe the rule in a few words first.', issues: [] });
      return;
    }
    if (noScope) {
      setProblem({ message: 'Choose where the rule applies: portfolio, watchlists or both.', issues: [] });
      return;
    }
    setRunning(true);
    try {
      let c = compiled.get(trimmed);
      if (!c) {
        c = await rulesStore.getState().compile({ text: trimmed, ...scopes });
        compiled.set(trimmed, c);
      }
      const result = c.result;
      if (result.status === 'UNSUPPORTED') {
        setProblem({
          message: userMessage('RULE_UNSUPPORTED', { reason: result.reason }) ?? result.reason,
          issues: [],
        });
        return;
      }
      const scopeIssues = checkRuleScopes(result.rule.variables, scopes);
      if (scopeIssues.length > 0) {
        setProblem({ message: 'Change where the rule applies:', issues: scopeIssues.map((i) => i.message) });
        return;
      }
      const dry = dryRun(result.rule, candidatesInScope(scopes, currentRuleCandidates()));
      setTested({ text: trimmed, scopes, compiled: { ...c, result }, dry });
      if (!name.trim()) setName(result.suggestedName.slice(0, MAX_NAME));
    } catch (e) {
      const code = toAppError(e).code;
      setProblem({
        message:
          code === 'AI_INVALID_OUTPUT'
            ? 'Couldn’t turn this into a rule. Try rephrasing it, e.g. like the examples.'
            : (userMessage(code) ?? 'Something went wrong.'),
        issues: [],
      });
    } finally {
      setRunning(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!tested || !canSave) return;
    setSaving(true);
    const { rule, readBack } = tested.compiled.result;
    const fields = {
      name: name.trim(),
      naturalPrompt: tested.text,
      compiledLogicJson: JSON.stringify(rule.json),
      readBack,
      variables: [...rule.variables],
      ...tested.scopes,
      compiledWith: { model: tested.compiled.model, promptVersion: tested.compiled.promptVersion },
    };
    const ok = existing
      ? await rulesStore.getState().update(existing.id, fields)
      : (await rulesStore.getState().create({ ...fields, enabled: true })) !== null;
    setSaving(false);
    if (ok) router.back();
    else {
      const code = rulesStore.getState().error;
      setProblem({ message: (code && userMessage(code)) ?? 'Couldn’t save the rule.', issues: [] });
      rulesStore.getState().clearError();
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Button label="Cancel" variant="link" onPress={() => router.back()} />
        <Text style={styles.title}>{existing ? 'Edit Rule' : 'Create Rule'}</Text>
        <Button label="Save" onPress={() => void save()} disabled={!canSave} loading={saving} />
      </View>
      {atLimit ? <Text style={styles.error}>{userMessage('RULE_LIMIT')}</Text> : null}

      <Text style={styles.section}>RULE IN PLAIN ENGLISH</Text>
      <View style={styles.editor}>
        <View style={styles.editorTop}>
          <MaterialCommunityIcons name="creation" size={16} color={colors.gain} />
          <Text style={styles.editorLabel}>AI RULE COMPILER</Text>
          <View style={styles.flex} />
          {text.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear text" onPress={() => setText('')}>
              <Text style={styles.clear}>✕ Clear</Text>
            </Pressable>
          ) : null}
        </View>
        <TextInput
          accessibilityLabel="Rule in plain English"
          value={text}
          onChangeText={setText}
          maxLength={MAX_TEXT}
          multiline
          placeholder="e.g. Alert me when RSI is below 30 and P/E is under 20"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
      </View>
      <View style={styles.chips}>
        {EXAMPLES.map((ex) => (
          <Pressable
            key={ex.label}
            accessibilityRole="button"
            accessibilityLabel={`Example: ${ex.text}`}
            onPress={() => setText(ex.text)}
            style={styles.example}
          >
            <Text style={styles.exampleText}>{ex.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>WHERE IT APPLIES</Text>
      <ToggleRow
        label="Apply to Portfolio"
        value={scopes.appliesToPortfolio}
        onChange={(v) => setScopes((s) => ({ ...s, appliesToPortfolio: v }))}
      />
      <ToggleRow
        label="Apply to Watchlists (all lists)"
        value={scopes.appliesToWatchlists}
        onChange={(v) => setScopes((s) => ({ ...s, appliesToWatchlists: v }))}
      />
      <View style={styles.toggle}>
        <Text style={styles.toggleLabel}>Evaluation cadence</Text>
        <Text style={styles.cadence}>Daily market close</Text>
      </View>

      <Button
        label={testCurrent ? 'Dry test passed' : 'Run dry test'}
        variant={testCurrent ? 'secondary' : 'primary'}
        icon={
          <MaterialCommunityIcons
            name="flask-outline"
            size={18}
            color={testCurrent ? colors.gain : colors.onGain}
          />
        }
        onPress={() => void runDryTest()}
        loading={running}
        disabled={atLimit || needsNetwork}
      />

      {needsNetwork ? (
        <Text style={styles.warn}>You’re offline: the dry test needs a connection to read the rule.</Text>
      ) : null}

      {problem ? (
        <View style={styles.problem}>
          <Text style={styles.error}>{problem.message}</Text>
          {problem.issues.map((i) => (
            <Text key={i} style={styles.body}>{`• ${i}`}</Text>
          ))}
        </View>
      ) : null}

      {tested ? (
        <View style={[styles.result, !testCurrent && styles.outdated]}>
          <Text style={styles.section}>THIS RULE WILL MATCH WHEN</Text>
          <Text style={styles.readBack}>
            {readBackParts.map((p, i) =>
              p.variable ? (
                <Text key={i} style={styles.variable}>
                  {p.text}
                </Text>
              ) : (
                p.text
              ),
            )}
          </Text>
          <Text style={styles.muted}>Check this wording: it is exactly what will run.</Text>
          {tested.dry.matches.length === 0 ? <Text style={styles.body}>No stocks match today.</Text> : null}
          <Matches title={`MATCHES TODAY (${tested.dry.matches.length})`} items={tested.dry.matches} />
          <Matches
            title={`INSUFFICIENT DATA (${tested.dry.insufficient.length})`}
            items={tested.dry.insufficient}
          />
          {!testCurrent ? (
            <Text style={styles.warn}>The text or scope changed: run the dry test again to save.</Text>
          ) : null}
        </View>
      ) : null}

      <TextField
        label="Rule name"
        icon="tag-outline"
        value={name}
        onChangeText={setName}
        maxLength={MAX_NAME}
        placeholder="Filled in by the dry test"
      />
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: spacing.md },
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    title: { ...typography.headlineSm, color: colors.textPrimary },
    section: { ...typography.microBadge, color: colors.textSecondary, marginTop: spacing.sm },
    editor: {
      borderWidth: 1,
      borderColor: colors.gain,
      borderRadius: radii.lg,
      backgroundColor: colors.surface1,
      padding: spacing.gutter,
      gap: spacing.sm,
    },
    editorTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    editorLabel: { ...typography.microBadge, color: colors.gain },
    clear: { ...typography.labelMd, color: colors.textSecondary },
    input: {
      ...typography.bodyLg,
      color: colors.textPrimary,
      minHeight: 96,
      textAlignVertical: 'top',
      padding: 0,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    example: {
      paddingHorizontal: spacing.md,
      minHeight: 32,
      justifyContent: 'center',
      borderRadius: radii.md,
      backgroundColor: colors.surface2,
      borderWidth: 1,
      borderColor: colors.border,
    },
    exampleText: { ...typography.labelMd, color: colors.textPrimary },
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 56,
      paddingHorizontal: spacing.gutter,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    toggleLabel: { ...typography.bodyLg, color: colors.textPrimary },
    cadence: { ...typography.labelMd, color: colors.textSecondary },
    problem: { gap: spacing.xs },
    result: {
      gap: spacing.sm,
      padding: spacing.gutter,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    outdated: { opacity: 0.6 },
    readBack: { ...typography.bodyLg, color: colors.textPrimary },
    variable: { color: colors.gain, fontFamily: 'monospace' },
    matchBlock: { gap: 2 },
    body: { ...typography.bodyMd, color: colors.textPrimary },
    muted: { ...typography.labelSm, color: colors.textMuted },
    warn: { ...typography.labelMd, color: colors.caution },
    error: { ...typography.labelMd, color: colors.loss },
  }),
);
