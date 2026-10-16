import { z } from 'zod';
import { RuleVariableSchema } from '../rules/variables';
import { InstrumentKeySchema, IsoDateSchema } from './primitives';

/** Maximum rules per user (HLD §10). */
export const MAX_RULES = 25;

/** Maximum stored length of the JSON-Logic string. */
export const MAX_COMPILED_LOGIC_LENGTH = 10_000;

const ruleFields = {
  name: z.string().trim().min(1).max(60),
  /** The user's English text (untrusted). */
  naturalPrompt: z.string().trim().min(3).max(500),
  /** JSON-Logic AST as a JSON string (Firestore cannot store nested arrays). Re-validated on every load. */
  compiledLogicJson: z.string().max(MAX_COMPILED_LOGIC_LENGTH),
  /** Deterministic plain-English read-back the user confirmed (LLD §2.8). */
  readBack: z.string().max(500),
  variables: z.array(RuleVariableSchema).min(1),
  appliesToPortfolio: z.boolean(),
  /** Means ALL watchlists (HLD D28). */
  appliesToWatchlists: z.boolean(),
  enabled: z.boolean(),
  compiledWith: z.object({ model: z.string().min(1), promptVersion: z.string().min(1) }),
};

const atLeastOneScope = (r: { appliesToPortfolio: boolean; appliesToWatchlists: boolean }): boolean =>
  r.appliesToPortfolio || r.appliesToWatchlists;
const scopeMessage = { message: 'Rule must apply to portfolio or watchlists' };

/** `users/{uid}/rules/{ruleId}` (LLD §1.7). */
export const RuleSchema = z
  .object({ schemaVersion: z.literal(1), ...ruleFields, createdAt: z.number(), updatedAt: z.number() })
  .refine(atLeastOneScope, scopeMessage);
/** Stored rule with its document ID. */
export type Rule = z.infer<typeof RuleSchema> & { id: string };

/** Input for creating a rule. */
export const NewRuleSchema = z.object(ruleFields).refine(atLeastOneScope, scopeMessage);
/** Input for creating a rule. */
export type NewRule = z.infer<typeof NewRuleSchema>;

/** Editable rule fields; the merged result is validated with {@link NewRuleSchema}. */
export type RulePatch = Partial<NewRule>;

/** Maximum matches stored per rule result. */
export const MAX_RULE_MATCHES = 200;

/** `users/{uid}/ruleResults/{YYYY-MM-DD}_{ruleId}`: one evaluation outcome per rule per session. */
export const RuleResultSchema = z.object({
  schemaVersion: z.literal(1),
  ruleId: z.string().min(1),
  sessionDate: IsoDateSchema,
  matches: z
    .array(z.object({ instrumentKey: InstrumentKeySchema, scope: z.enum(['PORTFOLIO', 'WATCHLIST']) }))
    .max(MAX_RULE_MATCHES),
  evaluatedAt: z.number(),
});
/** Stored rule result. */
export type RuleResult = z.infer<typeof RuleResultSchema>;

/** Deterministic document ID for a rule result. */
export function ruleResultId(sessionDate: string, ruleId: string): string {
  return `${sessionDate}_${ruleId}`;
}
