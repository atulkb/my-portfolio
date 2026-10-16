import type { Result } from '../util/result';

/**
 * Response-schema subset understood by Gemini structured output (OpenAPI-style, no recursion).
 * The app converts it to the SDK's Schema type; core stays SDK-free.
 */
export type JsonSchemaSubset =
  | {
      readonly type: 'object';
      readonly properties: Readonly<Record<string, JsonSchemaSubset>>;
      readonly required?: readonly string[];
      readonly nullable?: boolean;
      readonly description?: string;
    }
  | {
      readonly type: 'array';
      readonly items: JsonSchemaSubset;
      readonly minItems?: number;
      readonly maxItems?: number;
      readonly nullable?: boolean;
      readonly description?: string;
    }
  | {
      readonly type: 'string';
      readonly enum?: readonly string[];
      readonly nullable?: boolean;
      readonly description?: string;
    }
  | {
      readonly type: 'number' | 'integer';
      readonly minimum?: number;
      readonly maximum?: number;
      readonly nullable?: boolean;
      readonly description?: string;
    }
  | { readonly type: 'boolean'; readonly nullable?: boolean; readonly description?: string };

/** Prompt ready to send: system instruction + user content (data only). */
export type BuiltPrompt = { readonly system: string; readonly user: string };

/** Model tier from `AI_CONFIG.models`. */
export type ModelTier = 'flash' | 'flashLite';

/** Identifier of an AI task (keys of `AI_CONFIG.maxOutputTokens` / `temperature`). */
export type PromptTaskId =
  'performanceRating' | 'signals' | 'deepAnalysis' | 'ruleCompile' | 'marketSentiment';

/** A task with one input and one output. */
export type SinglePromptTask<I, O> = {
  readonly id: PromptTaskId;
  /** Bumped on any wording change; recorded with cached results. */
  readonly version: string;
  readonly model: ModelTier;
  readonly responseSchema: JsonSchemaSubset;
  build(input: I): BuiltPrompt;
  /** zod + post-checks (grounding, set equality…). Errors are fed back on retry where useful. */
  validate(input: I, raw: unknown): Result<O, string[]>;
};

/** Per-item outcome of a batch response; the client retries only `rejected` keys. */
export type BatchOutcome<O> = {
  readonly accepted: ReadonlyMap<string, O>;
  readonly rejected: readonly { readonly key: string; readonly reason: string }[];
};

/** A task over a batch of items (performance ratings, signals). */
export type BatchPromptTask<Item, Shared, O> = {
  readonly id: PromptTaskId;
  readonly version: string;
  readonly model: ModelTier;
  readonly maxBatch: number;
  readonly responseSchema: JsonSchemaSubset;
  keyOf(item: Item): string;
  build(items: readonly Item[], shared: Shared): BuiltPrompt;
  validate(items: readonly Item[], shared: Shared, raw: unknown): BatchOutcome<O>;
};
