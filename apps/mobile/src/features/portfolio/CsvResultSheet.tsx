import { MaterialCommunityIcons } from '@expo/vector-icons';
import { EXCHANGE_META, toInstrumentKey, type CsvIssue } from '@portfolio/core';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { userMessage } from '@/lib/messages';
import { formatDate, formatQuantity } from '@/lib/format';
import { toastStore } from '@/stores';
import { radii, spacing, typography } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/theme';
import { useCsvSheetContent } from './csvImport';

/** "file · line 12 · RELIANCEIND · NSE · 2024-03-15" (LLD §2.9). */
function issueLocation(i: CsvIssue): string {
  return [i.fileName, i.row !== null ? `line ${i.row}` : null, i.rowPreview].filter(Boolean).join(' · ');
}

function issuesAsText(issues: readonly CsvIssue[]): string {
  return issues
    .map((i) => `${issueLocation(i)}\n  ${i.message}${i.suggestion ? `\n  Fix: ${i.suggestion}` : ''}`)
    .join('\n');
}

function IssueRow({
  issue,
  warning = false,
}: {
  readonly issue: CsvIssue;
  readonly warning?: boolean;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.issue}>
      <Text style={styles.location}>{issueLocation(issue)}</Text>
      <Text style={[styles.message, { color: warning ? colors.caution : colors.textPrimary }]}>
        {issue.message}
      </Text>
      {issue.suggestion ? <Text style={styles.fix}>{`Fix: ${issue.suggestion}`}</Text> : null}
    </View>
  );
}

/** S05 result sheet: blocking issues (nothing imported) or the duplicate review (LLD §4.4). */
export function CsvResultSheet(): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useStyles();
  const content = useCsvSheetContent();

  const header = (title: string, subtitle: string): React.JSX.Element => (
    <View style={styles.header}>
      <View style={styles.flex}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{subtitle}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={10}
        onPress={() => router.back()}
      >
        <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
      </Pressable>
    </View>
  );

  if (!content) return header('Nothing to show', 'Upload a CSV from the + menu.');

  if (content.kind === 'errors') {
    const all = [...content.errors, ...content.warnings];
    return (
      <View style={styles.wrap}>
        {header(
          `${content.errors.length} ${content.errors.length === 1 ? 'issue' : 'issues'} in ${content.fileName}`,
          userMessage('IMPORT_INVALID') ?? '',
        )}
        <Button
          label="Copy issues"
          variant="secondary"
          onPress={() => {
            void Clipboard.setStringAsync(issuesAsText(all)).then(() =>
              toastStore.getState().show('Issues copied.'),
            );
          }}
        />
        {content.errors.map((i, n) => (
          <IssueRow key={`e${n}`} issue={i} />
        ))}
        {content.warnings.length > 0 ? (
          <Text style={styles.section}>WARNINGS (don’t block the import)</Text>
        ) : null}
        {content.warnings.map((i, n) => (
          <IssueRow key={`w${n}`} issue={i} warning />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {header(
        'Possible duplicates',
        'These buys match others on stock, platform, date and shares. They were imported; delete any you don’t want.',
      )}
      {content.groups.map((g) => {
        const key = toInstrumentKey(g.exchange, g.symbol);
        const copies = g.incoming.length + g.existingIds.length;
        const { currency } = EXCHANGE_META[g.exchange];
        return (
          <Pressable
            key={`${key}|${g.platform}|${g.tradeDate}|${g.quantity}`}
            accessibilityRole="button"
            accessibilityLabel={`${g.symbol}, ${copies} copies. Open edit buys`}
            style={styles.group}
            onPress={() => router.replace({ pathname: '/holding/[key]/edit', params: { key } })}
          >
            <View style={styles.flex}>
              <Text
                style={styles.message}
              >{`${g.symbol} · ${g.exchange.replace('_', ' ')} · ${g.platform}`}</Text>
              <Text style={styles.sub}>
                {`${formatDate(g.tradeDate)} · ${formatQuantity(g.quantity, currency)} shares · ${copies} copies`}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    wrap: { gap: spacing.md },
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    title: { ...typography.headlineSm, color: colors.textPrimary },
    sub: { ...typography.labelMd, color: colors.textSecondary },
    section: { ...typography.labelSm, color: colors.caution, marginTop: spacing.sm },
    issue: {
      gap: 2,
      padding: spacing.gutter,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    location: { ...typography.labelSm, color: colors.textSecondary },
    message: { ...typography.bodyMd, color: colors.textPrimary },
    fix: { ...typography.labelMd, color: colors.gain },
    group: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.gutter,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
  }),
);
