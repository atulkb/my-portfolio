import { z } from 'zod';
import type { MacroAssessment } from '../analysis/types';
import { err, ok, type Result } from '../util/result';
import { COMMON_RULES, dataBlock, r2 } from './common';
import { checkProse, collectFieldNames, collectNumbers } from './grounding';
import type { SinglePromptTask } from './types';

/** Deterministic macro figures for the Watchlist market card (HLD D34). */
export type MarketSentimentInput = {
  readonly macro: MacroAssessment;
  readonly usdInr: { readonly rate: number | null; readonly changePct: number | null };
};

/** Validated card text. */
export type MarketSentiment = { readonly headline: string; readonly paragraph: string };

const OutputSchema = z.object({ headline: z.string().min(1), paragraph: z.string().min(1) });

/** Advice wording the card must never use (HLD D34). */
export const BANNED_SENTIMENT_WORDS = /\b(buy|buying|sell|selling|allocate|allocation|stop[- ]?loss(es)?)\b/i;

const payloadOf = (i: MarketSentimentInput) => ({
  indiaVix: { value: r2(i.macro.indiaVix.value), level: i.macro.indiaVix.level },
  cboeVix: { value: r2(i.macro.vix.value), level: i.macro.vix.level },
  nifty50: { pctVsSma200: r2(i.macro.nifty.pctVsSma200), regime: i.macro.nifty.regime },
  sp500: { pctVsSma200: r2(i.macro.sp500.pctVsSma200), regime: i.macro.sp500.regime },
  usdInr: { rate: r2(i.usdInr.rate), changePct: r2(i.usdInr.changePct) },
});

const SYSTEM = `You write a short market-conditions note for the watchlist screen of a personal app, covering India and the US.
Write a headline (at most 8 words) and a paragraph (at most 50 words) describing conditions from the figures: volatility (VIX levels CALM/ELEVATED/FEAR), each index versus its 200-day average (ABOVE/NEAR/BELOW) and the USD/INR rate.
Describe conditions only. Never tell the reader to buy, sell, allocate, or set stop-losses.
- ${COMMON_RULES}`;

/** Market-sentiment paragraph task (HLD D34): once per day, temperature 0.3. */
export const marketSentimentTask: SinglePromptTask<MarketSentimentInput, MarketSentiment> = {
  id: 'marketSentiment',
  version: 'market-sentiment@2',
  responseSchema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'At most 8 words.' },
      paragraph: { type: 'string', description: 'At most 50 words.' },
    },
    required: ['headline', 'paragraph'],
  },
  build(input) {
    return { system: SYSTEM, user: dataBlock(payloadOf(input)) };
  },
  validate(input, raw): Result<MarketSentiment, string[]> {
    const parsed = OutputSchema.safeParse(raw);
    if (!parsed.success) return err(['Response did not match the schema.']);
    const { headline, paragraph } = parsed.data;
    const allowed = collectNumbers(payloadOf(input));
    const fieldNames = collectFieldNames(payloadOf(input));
    const problems = [
      checkProse('Headline', headline, 8, allowed, fieldNames),
      checkProse('Paragraph', paragraph, 50, allowed, fieldNames),
    ].filter((p): p is string => p !== null);
    if (BANNED_SENTIMENT_WORDS.test(`${headline} ${paragraph}`))
      problems.push('The note must not contain advice wording.');
    return problems.length > 0
      ? err(problems)
      : ok({ headline: headline.trim(), paragraph: paragraph.trim() });
  },
};
