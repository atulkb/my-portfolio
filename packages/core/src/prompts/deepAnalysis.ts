import { z } from 'zod';
import {
  FUNDAMENTAL_PARAMS,
  TECHNICAL_PARAMS,
  type MacroAssessment,
  type ParamResult,
} from '../analysis/types';
import type { Label } from '../market/types';
import { ExchangeSchema, type Exchange } from '../models/primitives';
import { err, ok, type Result } from '../util/result';
import { COMMON_RULES, dataBlock, r2 } from './common';
import { checkProse, collectNumbers } from './grounding';
import type { SinglePromptTask } from './types';

const PARAM_KEYS = [...TECHNICAL_PARAMS, ...FUNDAMENTAL_PARAMS] as const;

/** Inputs for one stock's narrative (S04). */
export type DeepAnalysisInput = {
  readonly symbol: string;
  readonly exchange: Exchange;
  readonly name: string;
  readonly sector: string | null;
  readonly params: readonly Pick<ParamResult, 'key' | 'group' | 'value' | 'level'>[];
  readonly healthScore: number | null;
  readonly healthLabel: Label | null;
  readonly macro: MacroAssessment;
  /** Present when the stock is held. */
  readonly position: {
    readonly pnlPct: number | null;
    readonly xirrPct: number | null;
    readonly benchmarkReturnPct: number | null;
    readonly excessReturnPp: number | null;
    readonly holdingDays: number;
  } | null;
  /** `features.aiSuggestions` effective value. */
  readonly allowAlternatives: boolean;
};

/** Validated narrative (ANALYSIS_FRAMEWORK §7). */
export type DeepAnalysis = {
  readonly summary: string;
  readonly pros: readonly { readonly paramKey: (typeof PARAM_KEYS)[number]; readonly text: string }[];
  readonly cons: readonly { readonly paramKey: (typeof PARAM_KEYS)[number]; readonly text: string }[];
  readonly risks: readonly string[];
  readonly watchFor: readonly string[];
  readonly alternatives: readonly {
    readonly symbol: string;
    readonly exchange: Exchange;
    readonly reason: string;
  }[];
};

const Point = z.object({ paramKey: z.enum(PARAM_KEYS), text: z.string().min(1) });
const OutputSchema = z.object({
  summary: z.string().min(1),
  pros: z.array(Point).max(5),
  cons: z.array(Point).max(5),
  risks: z.array(z.string().min(1)).max(3),
  watchFor: z.array(z.string().min(1)).max(3),
  alternatives: z
    .array(z.object({ symbol: z.string().min(1), exchange: ExchangeSchema, reason: z.string().min(1) }))
    .max(3)
    .nullable()
    .optional(),
});

const payloadOf = (i: DeepAnalysisInput) => ({
  symbol: i.symbol,
  exchange: i.exchange,
  name: i.name,
  sector: i.sector,
  healthScore: r2(i.healthScore),
  healthLabel: i.healthLabel,
  params: i.params.map((p) => ({ key: p.key, group: p.group, value: r2(p.value), level: p.level })),
  macro: {
    indiaVix: { value: r2(i.macro.indiaVix.value), level: i.macro.indiaVix.level },
    vix: { value: r2(i.macro.vix.value), level: i.macro.vix.level },
    nifty: { pctVsSma200: r2(i.macro.nifty.pctVsSma200), regime: i.macro.nifty.regime },
    sp500: { pctVsSma200: r2(i.macro.sp500.pctVsSma200), regime: i.macro.sp500.regime },
  },
  position: i.position && {
    pnlPct: r2(i.position.pnlPct),
    xirrPct: r2(i.position.xirrPct),
    benchmarkReturnPct: r2(i.position.benchmarkReturnPct),
    excessReturnPp: r2(i.position.excessReturnPp),
    holdingDays: Math.round(i.position.holdingDays),
  },
});

const system = (
  allowAlternatives: boolean,
): string => `You explain a pre-computed stock analysis in plain language for a personal app.
Write:
- summary: at most 80 words.
- pros: up to 5 points, each tied to a parameter whose level is GOOD (use its key as paramKey).
- cons: up to 5 points, each tied to a parameter whose level is BAD.
- risks: up to 3; watchFor: up to 3 (e.g. "RSI back above 40", "next quarterly results").
${
  allowAlternatives
    ? '- alternatives: up to 3 comparable listed stocks (symbol, exchange, short reason without numbers).'
    : '- alternatives: return null.'
}
Do not give buy or sell instructions. Use the macro context to frame the market regime.
- ${COMMON_RULES}`;

/** Deep-analysis narrative task (S04 AI Verdict). */
export const deepAnalysisTask: SinglePromptTask<DeepAnalysisInput, DeepAnalysis> = {
  id: 'deepAnalysis',
  version: 'deep-analysis@1',
  model: 'flash',
  responseSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      pros: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          properties: { paramKey: { type: 'string', enum: PARAM_KEYS }, text: { type: 'string' } },
          required: ['paramKey', 'text'],
        },
      },
      cons: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          properties: { paramKey: { type: 'string', enum: PARAM_KEYS }, text: { type: 'string' } },
          required: ['paramKey', 'text'],
        },
      },
      risks: { type: 'array', maxItems: 3, items: { type: 'string' } },
      watchFor: { type: 'array', maxItems: 3, items: { type: 'string' } },
      alternatives: {
        type: 'array',
        nullable: true,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            symbol: { type: 'string' },
            exchange: { type: 'string', enum: ExchangeSchema.options },
            reason: { type: 'string' },
          },
          required: ['symbol', 'exchange', 'reason'],
        },
      },
    },
    required: ['summary', 'pros', 'cons', 'risks', 'watchFor'],
  },
  build(input) {
    return { system: system(input.allowAlternatives), user: dataBlock(payloadOf(input)) };
  },
  validate(input, raw): Result<DeepAnalysis, string[]> {
    const parsed = OutputSchema.safeParse(raw);
    if (!parsed.success) return err(['Response did not match the schema.']);
    const out = parsed.data;
    const allowed = collectNumbers(payloadOf(input));
    const good = new Set(input.params.filter((p) => p.level === 'GOOD').map((p) => p.key));
    const bad = new Set(input.params.filter((p) => p.level === 'BAD').map((p) => p.key));
    const problems: string[] = [];
    for (const p of out.pros)
      if (!good.has(p.paramKey)) problems.push(`Pro "${p.paramKey}" is not a GOOD parameter.`);
    for (const c of out.cons)
      if (!bad.has(c.paramKey)) problems.push(`Con "${c.paramKey}" is not a BAD parameter.`);
    const alternatives = input.allowAlternatives ? (out.alternatives ?? []) : [];
    const prose: [string, string, number][] = [
      ['Summary', out.summary, 80],
      ...out.pros.map((p): [string, string, number] => ['Pro', p.text, 30]),
      ...out.cons.map((c): [string, string, number] => ['Con', c.text, 30]),
      ...out.risks.map((r): [string, string, number] => ['Risk', r, 30]),
      ...out.watchFor.map((w): [string, string, number] => ['Watch-for item', w, 20]),
      ...alternatives.map((a): [string, string, number] => ['Alternative reason', a.reason, 25]),
    ];
    for (const [field, text, max] of prose) {
      const problem = checkProse(field, text, max, allowed);
      if (problem) problems.push(problem);
    }
    if (problems.length > 0) return err(problems);
    return ok({
      summary: out.summary.trim(),
      pros: out.pros,
      cons: out.cons,
      risks: out.risks,
      watchFor: out.watchFor,
      alternatives: alternatives.map((a) => ({ ...a, symbol: a.symbol.toUpperCase() })),
    });
  },
};

/** Drops AI-proposed alternatives that are not in the master list (they are never shown as invented tickers). */
export function filterAlternatives(
  analysis: DeepAnalysis,
  exists: (exchange: Exchange, symbol: string) => boolean,
): DeepAnalysis {
  return { ...analysis, alternatives: analysis.alternatives.filter((a) => exists(a.exchange, a.symbol)) };
}
