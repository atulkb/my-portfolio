import { z } from 'zod';
import type { MacroAssessment, ParamKey, ParamLevel } from '../analysis/types';
import type { Label } from '../market/types';
import { ExchangeSchema, type Exchange } from '../models/primitives';
import { COMMON_RULES, dataBlock, itemKey, r2 } from './common';
import { checkProse, collectFieldNames, collectNumbers } from './grounding';
import type { BatchOutcome, BatchPromptTask } from './types';

/** Signal labels (ANALYSIS_FRAMEWORK §7.2). */
export const SIGNAL_LABELS = ['STRONG_BUY', 'BUY', 'HOLD', 'TRIM', 'SELL'] as const;
/** One signal label. */
export type SignalLabel = (typeof SIGNAL_LABELS)[number];

/** Computed inputs for one stock. */
export type SignalInput = {
  readonly symbol: string;
  readonly exchange: Exchange;
  readonly scope: 'PORTFOLIO' | 'WATCHLIST';
  readonly healthScore: number | null;
  readonly healthLabel: Label | null;
  /** True when most parameters are ⚪ — the model must answer HOLD. */
  readonly insufficientData: boolean;
  readonly params: readonly {
    readonly key: ParamKey;
    readonly value: number | null;
    readonly level: ParamLevel;
  }[];
  readonly pnlPct: number | null;
  readonly targetEntryPrice: number | null;
  readonly targetExitPrice: number | null;
};

/** Validated signal for one stock. */
export type Signal = {
  readonly label: SignalLabel;
  readonly confidencePct: number;
  /** Echo of the user's watchlist target, never invented. */
  readonly targetEntryPrice: number | null;
  readonly reason: string;
};

const OutputSchema = z.object({
  signals: z.array(
    z.object({
      symbol: z.string(),
      exchange: ExchangeSchema,
      label: z.enum(SIGNAL_LABELS),
      confidencePct: z.number().int().min(0).max(100),
      targetEntryPrice: z.number().nullable().optional(),
      reason: z.string().min(1),
    }),
  ),
});

const payloadOf = (i: SignalInput) => ({
  symbol: i.symbol,
  exchange: i.exchange,
  scope: i.scope,
  healthScore: r2(i.healthScore),
  healthLabel: i.healthLabel,
  insufficientData: i.insufficientData,
  params: i.params.map((p) => ({ key: p.key, value: r2(p.value), level: p.level })),
  pnlPct: r2(i.pnlPct),
  targetEntryPrice: i.targetEntryPrice,
  targetExitPrice: i.targetExitPrice,
});

const macroPayload = (m: MacroAssessment) => ({
  indiaVix: { value: r2(m.indiaVix.value), level: m.indiaVix.level },
  vix: { value: r2(m.vix.value), level: m.vix.level },
  nifty: { pctVsSma200: r2(m.nifty.pctVsSma200), regime: m.nifty.regime },
  sp500: { pctVsSma200: r2(m.sp500.pctVsSma200), regime: m.sp500.regime },
});

const SYSTEM = `You give a buy/sell signal label for each stock in a personal app, from pre-computed parameters only.
Labels: STRONG_BUY, BUY, HOLD, TRIM, SELL. Also give confidencePct (integer 0–100, your own confidence) and a reason of at most 25 words citing at least one supplied number or parameter.
Rules:
- Parameter levels GOOD/AVERAGE/BAD/NA are already computed; weigh them with healthScore and the macro context.
- If insufficientData is true the label MUST be HOLD and the reason must say data is insufficient.
- targetEntryPrice: repeat the supplied value exactly, or null. Never invent one.
Return exactly one signal per stock, with the same symbol and exchange. This is informational, not investment advice.
- ${COMMON_RULES}`;

/** Buy/sell signal task (HLD D29, ANALYSIS_FRAMEWORK §7.2). Only used when aiSuggestions is on. */
export const signalsTask: BatchPromptTask<SignalInput, MacroAssessment, Signal> = {
  id: 'signals',
  version: 'signals@2',
  maxBatch: 25,
  responseSchema: {
    type: 'object',
    properties: {
      signals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            symbol: { type: 'string' },
            exchange: { type: 'string', enum: ExchangeSchema.options },
            label: { type: 'string', enum: SIGNAL_LABELS },
            confidencePct: { type: 'integer', minimum: 0, maximum: 100 },
            targetEntryPrice: { type: 'number', nullable: true },
            reason: { type: 'string', description: 'At most 25 words; cite a supplied number or parameter.' },
          },
          required: ['symbol', 'exchange', 'label', 'confidencePct', 'reason'],
        },
      },
    },
    required: ['signals'],
  },
  keyOf: itemKey,
  build(items, macro) {
    return { system: SYSTEM, user: dataBlock({ macro: macroPayload(macro), stocks: items.map(payloadOf) }) };
  },
  validate(items, macro, raw): BatchOutcome<Signal> {
    const accepted = new Map<string, Signal>();
    const rejected: { key: string; reason: string }[] = [];
    const wanted = new Map(items.map((i) => [itemKey(i), i]));
    const parsed = OutputSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        accepted,
        rejected: [...wanted.keys()].map((key) => ({ key, reason: 'Response did not match the schema.' })),
      };
    }
    const macroNumbers = collectNumbers(macroPayload(macro));
    const seen = new Set<string>();
    for (const s of parsed.data.signals) {
      const key = itemKey(s);
      const input = wanted.get(key);
      if (!input || seen.has(key)) continue;
      seen.add(key);
      if (input.insufficientData && s.label !== 'HOLD') {
        rejected.push({ key, reason: 'Insufficient data must be labelled HOLD.' });
        continue;
      }
      const payload = payloadOf(input);
      const problem = checkProse(
        'Reason',
        s.reason,
        25,
        [...collectNumbers(payload), ...macroNumbers],
        collectFieldNames({ payload, macro: macroPayload(macro) }),
      );
      if (problem) {
        rejected.push({ key, reason: problem });
        continue;
      }
      accepted.set(key, {
        label: s.label,
        confidencePct: s.confidencePct,
        targetEntryPrice: s.targetEntryPrice === input.targetEntryPrice ? input.targetEntryPrice : null,
        reason: s.reason.trim(),
      });
    }
    for (const key of wanted.keys())
      if (!seen.has(key)) rejected.push({ key, reason: 'Missing from the response.' });
    return { accepted, rejected };
  },
};
