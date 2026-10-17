import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  EXCHANGE_META,
  parseInstrumentKey,
  type Currency,
  type InstrumentKey,
  type ParamLevel,
  type ParamResult,
} from '@portfolio/core';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ExchangeBadge, LabelBadge, SymbolTile } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { PriceChart } from '@/components/PriceChart';
import { RangeBar } from '@/components/RangeBar';
import { Screen } from '@/components/Screen';
import { refFor, useHolding } from '@/features/portfolio/hooks';
import { useInstrumentRules, type InstrumentRuleRow } from '@/features/rules/hooks';
import { useListsContaining } from '@/features/watchlist/hooks';
import {
  formatDate,
  formatMoney,
  formatPct,
  formatQuantity,
  formatSignedMoney,
  priceSourceNote,
} from '@/lib/format';
import { userMessage } from '@/lib/messages';
import { getInstrumentIndex } from '@/services/instruments/instrumentIndex';
import { marketStore, uiStore, useAi, useInstruments, useMarket, useSession } from '@/stores';
import { colors, labelColors, radii, spacing, typography } from '@/theme/tokens';
import { useAiSuggestions, useDeepAnalysis } from './ai';
import { AiVerdictCard, AlternativesCard } from './AiVerdict';
import { MarketContextCard } from './MarketContext';
import { useAnalysisEntry, usePositionBenchmark } from './hooks';
import { formatParamValue, PARAM_LABEL } from './params';
import { resolveSector } from './sector';

/** Sessions shown in the chart (~3 months). */
const CHART_SESSIONS = 63;

type Tab = 'VERDICT' | 'FUNDAMENTAL' | 'TECHNICAL' | 'RULES';
const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'VERDICT', label: 'AI Verdict' },
  { value: 'FUNDAMENTAL', label: 'Fundamentals' },
  { value: 'TECHNICAL', label: 'Technicals' },
  { value: 'RULES', label: 'Rules' },
];

const OUTCOME: Readonly<Record<InstrumentRuleRow['outcome'], { text: string; color: string }>> = {
  MATCH: { text: 'Match', color: colors.gain },
  NO_MATCH: { text: 'No match', color: colors.textSecondary },
  INSUFFICIENT_DATA: { text: 'Insufficient data', color: colors.caution },
  INVALID: { text: 'Needs attention', color: colors.caution },
};

/** S04 Rules tab: enabled rules covering this stock, evaluated live on today's data. */
function RulesTab({ instrumentKey }: { readonly instrumentKey: InstrumentKey }): React.JSX.Element {
  const { rows, inScope } = useInstrumentRules(instrumentKey);
  return (
    <Card>
      <Text style={styles.cardTitle}>Rules</Text>
      {!inScope ? (
        <Text style={styles.muted}>
          Rules run on your portfolio and watchlists. Add this stock to a watchlist to check it.
        </Text>
      ) : rows.length === 0 ? (
        <Text style={styles.muted}>No active rules apply to this stock.</Text>
      ) : (
        rows.map((r) => (
          <View key={r.rule.id} style={styles.param}>
            <View style={styles.paramTop}>
              <Text style={styles.paramName}>{r.rule.name}</Text>
              <Text style={[styles.outcome, { color: OUTCOME[r.outcome].color }]}>
                {OUTCOME[r.outcome].text}
              </Text>
            </View>
            <Text style={styles.reason}>{r.rule.readBack}</Text>
          </View>
        ))
      )}
      <Button label="Manage rules" variant="link" onPress={() => router.navigate('/rules')} />
    </Card>
  );
}

const LEVEL_TEXT: Readonly<Record<ParamLevel, string>> = {
  GOOD: 'Good',
  AVERAGE: 'Average',
  BAD: 'Bad',
  NA: 'No data',
};

const signColor = (n: number | null): string =>
  n === null || n === 0 ? colors.textSecondary : n > 0 ? colors.gain : colors.loss;

function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/research');
}

function Card({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <View style={styles.card}>{children}</View>;
}

function ParamRow({ p, currency }: { readonly p: ParamResult; readonly currency: Currency }) {
  const c = labelColors[p.level === 'NA' ? 'NONE' : p.level];
  return (
    <View
      style={styles.param}
      accessible
      accessibilityLabel={`${PARAM_LABEL[p.key]}: ${LEVEL_TEXT[p.level]}. ${p.reason}`}
    >
      <View style={styles.paramTop}>
        <Text style={styles.paramName}>{PARAM_LABEL[p.key]}</Text>
        <Text style={styles.paramValue}>{formatParamValue(p, currency)}</Text>
        <Text style={[styles.level, { color: c.fg, backgroundColor: c.bg }]}>{LEVEL_TEXT[p.level]}</Text>
      </View>
      <Text style={styles.reason}>{p.reason}</Text>
    </View>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  readonly label: string;
  readonly value: string;
  readonly color?: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.caption}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

/**
 * S04 Research for one instrument (LLD §4.4): header, price card with the 3-month chart and
 * ranges, AI Verdict (Health, AI synthesis, signal, alternatives), Fundamentals and Technicals
 * tabs (deterministic market context), Rules tab, ★ add to watchlist, and "Your position" for
 * held stocks.
 */
export function ResearchScreen({ instrumentKey }: { readonly instrumentKey: InstrumentKey | null }) {
  const key = instrumentKey;
  const [tab, setTab] = useState<Tab>('VERDICT');
  const listVersion = useInstruments((s) => s.meta?.version);
  const snapshot = useMarket((s) => (key ? s.snapshots.get(key) : undefined));
  const fundamentalsKnown = useMarket((s) => (key ? s.fundamentals.has(key) : false));
  const profiles = useMarket((s) => s.profiles);
  const load = useMarket((s) => (key ? s.instrumentLoads.get(key) : undefined));
  const overrides = useSession((s) => s.profile?.sectorOverrides);
  const entry = useAnalysisEntry(key);
  const holding = useHolding(key);
  const bench = usePositionBenchmark(holding);
  const refreshRunning = useMarket((s) => s.refresh.running);
  const suggestions = useAiSuggestions();
  const signal = useAi((s) => (key && suggestions ? (s.signals[key]?.value ?? null) : null));
  const performanceReason = useAi((s) => (key ? (s.performance[key]?.value.reason ?? null) : null));
  const watchedIn = useListsContaining(key);

  const hit = useMemo(
    () => (key && listVersion ? (getInstrumentIndex()?.byKey.get(key) ?? null) : null),
    [key, listVersion],
  );
  const name = hit?.instrument.name ?? holding?.name ?? (key ? (parseInstrumentKey(key)?.symbol ?? key) : '');
  const isEtf = hit?.instrument.type === 'ETF';
  const sector = key
    ? resolveSector(key, { overrides, profiles, index: hit ? getInstrumentIndex() : null })
    : null;
  const loading = load?.state === 'loading';
  // Wait for fundamentals (or their failure) so the narrative isn't written from technicals alone.
  const aiReady =
    !!snapshot && !!entry && !loading && (fundamentalsKnown || isEtf || !!load?.failure || !refreshRunning);
  const deep = useDeepAnalysis({
    key: key ?? ('' as InstrumentKey),
    name,
    sector,
    entry,
    holding,
    bench,
    ready: !!key && aiReady,
    visible: tab === 'VERDICT',
  });

  useEffect(() => {
    if (!key) return;
    uiStore.getState().addRecentResearch(key);
    const ref = refFor(key);
    if (ref) void marketStore.getState().loadInstrument(ref);
  }, [key]);

  const parsed = key ? parseInstrumentKey(key) : null;
  if (!key || !parsed) {
    return (
      <Screen>
        <Text style={styles.muted}>This stock link is not valid.</Text>
      </Screen>
    );
  }
  const currency = EXCHANGE_META[parsed.exchange].currency;
  const analysis = entry?.analysis ?? null;
  const ind = entry?.indicators ?? null;
  const lastBar = snapshot?.bars.at(-1) ?? null;
  const dayChange = snapshot && snapshot.prevClose !== null ? snapshot.close - snapshot.prevClose : null;
  const dayPct = snapshot && snapshot.prevClose ? ((dayChange ?? 0) / snapshot.prevClose) * 100 : null;
  const chart = snapshot ? snapshot.bars.slice(-CHART_SESSIONS).map((b) => b.adjClose) : [];
  const params =
    analysis?.params.filter((p) =>
      tab === 'FUNDAMENTAL' ? p.group === 'FUNDAMENTAL' : p.group === 'TECHNICAL',
    ) ?? [];
  const score = (s: number | null): string => (s === null ? '—' : String(Math.round(50 + 50 * s)));

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} onPress={goBack}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textPrimary} />
        </Pressable>
        <SymbolTile symbol={parsed.symbol} />
        <View style={styles.flex}>
          <View style={styles.row}>
            <Text style={styles.symbol}>{parsed.symbol}</Text>
            <ExchangeBadge exchange={parsed.exchange} />
          </View>
          <Text style={styles.muted} numberOfLines={2}>
            {sector ? `${name} · ${sector}` : name}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={watchedIn.length > 0 ? 'On your watchlists. Change lists' : 'Add to watchlist'}
          hitSlop={10}
          onPress={() => router.push({ pathname: '/sheets/watchlist-pick', params: { key } })}
        >
          <MaterialCommunityIcons
            name={watchedIn.length > 0 ? 'star' : 'star-outline'}
            size={26}
            color={watchedIn.length > 0 ? colors.gain : colors.textSecondary}
          />
        </Pressable>
      </View>

      <Card>
        {snapshot ? (
          <>
            <View style={styles.priceRow}>
              <View style={styles.flex}>
                <Text style={styles.price}>{formatMoney(snapshot.close, currency)}</Text>
                {dayChange !== null ? (
                  <Text style={[styles.change, { color: signColor(dayChange) }]}>
                    {`${dayChange >= 0 ? '▲' : '▼'} ${formatSignedMoney(dayChange, currency)} (${formatPct(dayPct, { signed: true })})`}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.asOf, snapshot.stale && { color: colors.caution }]}>
                {`${snapshot.stale ? 'As of' : 'Close ·'} ${formatDate(snapshot.sessionDate, { short: true })}`}
              </Text>
            </View>
            {priceSourceNote(snapshot) ? (
              <Text style={[styles.asOf, { color: colors.caution }]}>{priceSourceNote(snapshot)}</Text>
            ) : null}
            <PriceChart values={chart} />
            <RangeBar
              title="DAY RANGE"
              low={lastBar?.low ?? null}
              high={lastBar?.high ?? null}
              value={snapshot.close}
              lowLabel={`Low ${formatMoney(lastBar?.low ?? null, currency)}`}
              highLabel={`High ${formatMoney(lastBar?.high ?? null, currency)}`}
            />
            <RangeBar
              title={ind?.range52wPartial ? 'RANGE (< 1 YR)' : '52W RANGE'}
              low={ind?.low52w ?? null}
              high={ind?.high52w ?? null}
              value={snapshot.close}
              lowLabel={`Low ${formatMoney(ind?.low52w ?? null, currency)}`}
              highLabel={`High ${formatMoney(ind?.high52w ?? null, currency)}`}
            />
          </>
        ) : loading ? (
          <ActivityIndicator color={colors.gain} accessibilityLabel="Loading price" />
        ) : (
          <Text style={styles.muted}>
            {load?.failure ? userMessage(load.failure) : 'No price data for this stock yet.'}
          </Text>
        )}
      </Card>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Chip key={t.value} label={t.label} selected={tab === t.value} onPress={() => setTab(t.value)} />
        ))}
      </View>

      {tab === 'VERDICT' ? (
        <AiVerdictCard
          entry={deep.entry}
          load={deep.load}
          signal={signal}
          canRefresh={deep.canRefresh}
          onRefresh={deep.refresh}
        />
      ) : null}

      {tab === 'VERDICT' ? (
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Health</Text>
            <LabelBadge
              kind="health"
              label={analysis?.healthLabel ?? null}
              score={analysis?.healthScore ?? null}
            />
          </View>
          {analysis ? (
            <>
              <View style={styles.statGrid}>
                <Stat label="TECHNICAL" value={score(analysis.technicalScore)} />
                <Stat label="FUNDAMENTAL" value={score(analysis.fundamentalScore)} />
              </View>
              {analysis.healthLabel === null ? (
                <Text style={styles.muted}>
                  Not enough data for a Health score: fewer than half of the parameters are available.
                </Text>
              ) : null}
              {analysis.pros.length > 0 ? (
                <Text style={[styles.caption, { color: colors.gain }]}>STRENGTHS</Text>
              ) : null}
              {analysis.pros.map((p) => (
                <Text key={p.key} style={styles.bullet}>{`▲ ${p.reason}`}</Text>
              ))}
              {analysis.cons.length > 0 ? (
                <Text style={[styles.caption, { color: colors.loss }]}>WEAKNESSES</Text>
              ) : null}
              {analysis.cons.map((p) => (
                <Text key={p.key} style={styles.bullet}>{`▼ ${p.reason}`}</Text>
              ))}
            </>
          ) : (
            <Text style={styles.muted}>{loading ? 'Analysing…' : 'Health needs price history.'}</Text>
          )}
        </Card>
      ) : tab === 'RULES' ? (
        <RulesTab instrumentKey={key} />
      ) : (
        <Card>
          {tab === 'FUNDAMENTAL' && isEtf ? (
            <Text style={styles.muted}>ETFs have no company fundamentals; only technicals are scored.</Text>
          ) : null}
          {tab === 'FUNDAMENTAL' && !isEtf && !fundamentalsKnown ? (
            <Text style={styles.muted}>
              {loading ? 'Loading fundamentals…' : 'Fundamentals not loaded yet.'}
            </Text>
          ) : null}
          {params.length === 0 && !(tab === 'FUNDAMENTAL' && isEtf) ? (
            <Text style={styles.muted}>No parameters to show yet.</Text>
          ) : null}
          {params.map((p) => (
            <ParamRow key={p.key} p={p} currency={currency} />
          ))}
        </Card>
      )}

      {tab === 'TECHNICAL' && analysis ? <MarketContextCard macro={analysis.macro} withNote={false} /> : null}

      {tab === 'VERDICT' && suggestions && deep.entry ? (
        <AlternativesCard analysis={deep.entry.value} />
      ) : null}

      {holding ? (
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Your position</Text>
            <LabelBadge kind="performance" label={holding.performance} />
          </View>
          {holding.performance && performanceReason ? (
            <Text style={styles.reason}>{`AI: ${performanceReason}`}</Text>
          ) : null}
          <View style={styles.statGrid}>
            <Stat label="SHARES" value={formatQuantity(holding.quantity, currency)} />
            <Stat label="AVG PRICE" value={formatMoney(holding.avgPrice, currency)} />
            <Stat label="INVESTED" value={formatMoney(holding.invested, currency)} />
            <Stat label="VALUE" value={formatMoney(holding.value, currency)} />
            <Stat
              label="TOTAL RETURN"
              value={`${formatSignedMoney(holding.pnl, currency)} (${formatPct(holding.pnlPct, { signed: true })})`}
              color={signColor(holding.pnl)}
            />
            <Stat
              label="CAGR"
              value={holding.xirrPct === null ? '— (< 1 yr)' : formatPct(holding.xirrPct, { signed: true })}
              color={signColor(holding.xirrPct)}
            />
            <Stat
              label={`${bench?.name.toUpperCase() ?? 'INDEX'} (PRICE INDEX)`}
              value={formatPct(bench?.returnPct ?? null, { signed: true })}
              color={signColor(bench?.returnPct ?? null)}
            />
            <Stat
              label="VS INDEX"
              value={
                bench?.excessPp === null || bench?.excessPp === undefined
                  ? '—'
                  : `${bench.excessPp >= 0 ? '+' : '−'}${Math.abs(bench.excessPp).toFixed(2)} pp`
              }
              color={signColor(bench?.excessPp ?? null)}
            />
            <Stat label="HELD (AVG)" value={`${holding.holdingDays} days`} />
          </View>
          <Text style={styles.muted}>
            Index return: the same amounts invested on the same dates; dividends not included on either side.
          </Text>
        </Card>
      ) : null}

      <Text style={styles.disclaimer}>
        For information only — not investment advice. Scores are computed from public market data, which may
        be delayed, incomplete or wrong; AI text and signals can be mistaken. Do your own research before
        investing.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  symbol: { ...typography.headlineSm, color: colors.textPrimary },
  muted: { ...typography.bodyMd, color: colors.textSecondary },
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: { ...typography.headlineSm, color: colors.textPrimary },
  priceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  price: { ...typography.displayHero, color: colors.textPrimary },
  change: { ...typography.labelMd },
  asOf: { ...typography.labelSm, color: colors.textSecondary },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  param: { gap: 2, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  paramTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  paramName: { ...typography.labelMd, color: colors.textPrimary, flex: 1 },
  paramValue: { ...typography.metricMd, color: colors.textPrimary },
  level: {
    ...typography.microBadge,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.base,
    overflow: 'hidden',
    minWidth: 56,
    textAlign: 'center',
  },
  reason: { ...typography.bodyMd, color: colors.textSecondary },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  stat: { width: '50%', gap: 2, paddingRight: spacing.sm },
  caption: { ...typography.microBadge, color: colors.textMuted },
  statValue: { ...typography.metricMd, color: colors.textPrimary },
  bullet: { ...typography.bodyMd, color: colors.textPrimary },
  outcome: { ...typography.labelMd },
  disclaimer: {
    ...typography.labelSm,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
});
