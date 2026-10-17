import { z } from 'zod';
import { LabelSchema, type Label } from '../market/types';
import { ExchangeSchema, type Exchange } from '../models/primitives';
import { COMMON_RULES, dataBlock, itemKey, r2 } from './common';
import { checkProse, collectFieldNames, collectNumbers } from './grounding';
import type { BatchOutcome, BatchPromptTask } from './types';

/** Deterministic inputs for one holding (ANALYSIS_FRAMEWORK §4.1). */
export type PerformanceInput = {
  readonly symbol: string;
  readonly exchange: Exchange;
  readonly pnlPct: number | null;
  readonly xirrPct: number | null;
  readonly benchmark: string;
  readonly benchmarkReturnPct: number | null;
  readonly excessReturnPp: number | null;
  readonly holdingDays: number;
  readonly healthScore: number | null;
  readonly healthLabel: Label | null;
  readonly drawdownPct: number | null;
  readonly volatilityPct: number | null;
};

/** Validated rating for one holding. */
export type PerformanceRating = { readonly rating: Label; readonly reason: string };

const OutputSchema = z.object({
  ratings: z.array(
    z.object({
      symbol: z.string(),
      exchange: ExchangeSchema,
      rating: LabelSchema,
      reason: z.string().min(1),
    }),
  ),
});

const payloadOf = (i: PerformanceInput) => ({
  symbol: i.symbol,
  exchange: i.exchange,
  pnlPct: r2(i.pnlPct),
  xirrPct: r2(i.xirrPct),
  benchmark: i.benchmark,
  benchmarkReturnPct: r2(i.benchmarkReturnPct),
  excessReturnPp: r2(i.excessReturnPp),
  holdingDays: Math.round(i.holdingDays),
  healthScore: r2(i.healthScore),
  healthLabel: i.healthLabel,
  drawdownPct: r2(i.drawdownPct),
  volatilityPct: r2(i.volatilityPct),
});

const SYSTEM = `You rate how well each holding in a personal stock portfolio has performed.
For each holding return GOOD, AVERAGE or BAD with a reason of at most 20 words that cites at least one supplied number.
Guidance:
- GOOD: clearly beating its benchmark over the period held.
- BAD: clearly trailing its benchmark, or a large loss.
- AVERAGE: roughly in line with the benchmark, or too early to judge (holdingDays under 90 should lean AVERAGE).
- excessReturnPp (return minus benchmark, in percentage points) is the most important input; xirrPct and benchmarkReturnPct are annualised when present, otherwise use pnlPct.
- healthScore and healthLabel give context only; they are not a substitute for return.
Return exactly one rating per holding, with the same symbol and exchange.
- ${COMMON_RULES}`;

/** Performance rating task (HLD D11, ANALYSIS_FRAMEWORK §7.1): batched, temperature 0. */
export const performanceRatingTask: BatchPromptTask<PerformanceInput, null, PerformanceRating> = {
  id: 'performanceRating',
  version: 'perf-rating@2',
  model: 'flash',
  maxBatch: 25,
  responseSchema: {
    type: 'object',
    properties: {
      ratings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            symbol: { type: 'string' },
            exchange: { type: 'string', enum: ExchangeSchema.options },
            rating: { type: 'string', enum: LabelSchema.options },
            reason: { type: 'string', description: 'At most 20 words; cite a supplied number.' },
          },
          required: ['symbol', 'exchange', 'rating', 'reason'],
        },
      },
    },
    required: ['ratings'],
  },
  keyOf: itemKey,
  build(items) {
    return { system: SYSTEM, user: dataBlock({ holdings: items.map(payloadOf) }) };
  },
  validate(items, _shared, raw): BatchOutcome<PerformanceRating> {
    const accepted = new Map<string, PerformanceRating>();
    const rejected: { key: string; reason: string }[] = [];
    const parsed = OutputSchema.safeParse(raw);
    const wanted = new Map(items.map((i) => [itemKey(i), i]));
    if (!parsed.success) {
      return {
        accepted,
        rejected: [...wanted.keys()].map((key) => ({ key, reason: 'Response did not match the schema.' })),
      };
    }
    const seen = new Set<string>();
    for (const r of parsed.data.ratings) {
      const key = itemKey(r);
      const input = wanted.get(key);
      if (!input || seen.has(key)) continue; // extra or duplicate entries are ignored
      seen.add(key);
      const payload = payloadOf(input);
      const problem = checkProse('Reason', r.reason, 20, collectNumbers(payload), collectFieldNames(payload));
      if (problem) rejected.push({ key, reason: problem });
      else accepted.set(key, { rating: r.rating, reason: r.reason.trim() });
    }
    for (const key of wanted.keys())
      if (!seen.has(key)) rejected.push({ key, reason: 'Missing from the response.' });
    return { accepted, rejected };
  },
};
