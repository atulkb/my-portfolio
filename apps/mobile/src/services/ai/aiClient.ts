import {
  AppError,
  toAppError,
  type BatchPromptTask,
  type BuiltPrompt,
  type GenerateResult,
  type GenerativePort,
  type JsonSchemaSubset,
  type PromptTaskId,
  type SinglePromptTask,
} from '@portfolio/core';

import type { AiUsage } from './usage';

/** Limits used by the client (from `AI_CONFIG`). */
export type AiClientConfig = {
  readonly maxRetries: number;
  readonly retryBackoffMs: readonly number[];
  readonly batchSize: number;
  readonly requestTimeoutMs: number;
};

/** Dependencies, injected so tests use a fake model and no real waiting. */
export type AiClientDeps = {
  readonly port: GenerativePort;
  readonly usage: AiUsage;
  readonly config: AiClientConfig;
  readonly sleep: (ms: number) => Promise<void>;
  /** Dev diagnostics: task id, version, attempts, token usage, error code — never prompts or replies. */
  readonly log?: (line: string) => void;
  /** Dev builds: SDK code/message behind an error, appended to `log` lines. */
  readonly describeError?: (e: unknown) => string | null;
};

/** Outcome of a batch run: every requested key, `null` where no valid answer was obtained. */
export type BatchRun<O> = {
  readonly results: ReadonlyMap<string, O | null>;
  /** Why items are missing: a non-retryable stop (budget, rate limit…) or the last retryable error. */
  readonly error: AppError | null;
  readonly calls: number;
  /** Model of the last answered request (HLD D36 chain); `null` when nothing was answered. */
  readonly model: string | null;
};

/** Bounded Gemini loop (LLD §3.5 `AiClient.run`). */
export type AiClient = {
  /** One input → one validated output; throws `AppError` (e.g. `AI_INVALID_OUTPUT` after the last attempt). */
  runSingle<I, O>(
    task: SinglePromptTask<I, O>,
    input: I,
  ): Promise<{ value: O; calls: number; model: string }>;
  /** Batched items; retries ask only for the missing/invalid items. */
  runBatch<Item, Shared, O>(
    task: BatchPromptTask<Item, Shared, O>,
    items: readonly Item[],
    shared: Shared,
  ): Promise<BatchRun<O>>;
};

/** Parses the model's JSON text; tolerates a Markdown code fence around it. */
export function parseModelJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** Appends validator feedback (our own text, never user input) for the next attempt. */
function withFeedback(prompt: BuiltPrompt, problems: readonly string[]): BuiltPrompt {
  if (problems.length === 0) return prompt;
  const list = problems
    .slice(0, 10)
    .map((p) => `- ${p}`)
    .join('\n');
  return {
    ...prompt,
    user: `${prompt.user}\n\nYour previous reply was rejected:\n${list}\nFix these issues.`,
  };
}

/** Creates the AI client over a {@link GenerativePort}. */
export function createAiClient(deps: AiClientDeps): AiClient {
  const { port, usage, config } = deps;
  const attemptsMax = config.maxRetries + 1;

  async function backoff(attempt: number): Promise<void> {
    const ms = config.retryBackoffMs[Math.min(attempt - 1, config.retryBackoffMs.length - 1)] ?? 0;
    if (ms > 0) await deps.sleep(ms);
  }

  /** Request counter shared by the attempts of one run. */
  type Counter = { calls: number; model: string | null };

  /**
   * One request: picks the best model with quota left, calls it, checks truncation. A 429 puts
   * that model on cooldown and a missing model (404) is skipped, then the next model in the chain
   * is tried at once (HLD D36); the loop ends when the budget has no model left.
   * `counter.calls` counts requests actually sent.
   */
  async function call(
    task: { readonly id: PromptTaskId; readonly version: string },
    responseSchema: JsonSchemaSubset,
    prompt: BuiltPrompt,
    counter: Counter,
  ): Promise<{ raw: unknown; problem: string | null }> {
    for (;;) {
      const model = await usage.acquire();
      counter.calls++;
      let res: GenerateResult;
      try {
        res = await port.generate({
          taskId: task.id,
          model,
          prompt,
          responseSchema,
          timeoutMs: config.requestTimeoutMs,
        });
      } catch (e) {
        const ae = toAppError(e);
        if (ae.code === 'AI_RATE_LIMITED') {
          usage.rateLimited(model);
          deps.log?.(`${task.version} model=${model} rate-limited, trying the next model`);
          continue;
        }
        if (ae.code === 'AI_UNAVAILABLE' && ae.context['status'] === 404) {
          usage.unavailable(model);
          deps.log?.(`${task.version} model=${model} not available, trying the next model`);
          continue;
        }
        throw e;
      }
      counter.model = model;
      if (res.usage)
        deps.log?.(
          `${task.version} model=${model} tokens in=${res.usage.promptTokens} out=${res.usage.outputTokens} thoughts=${res.usage.thoughtsTokens} finish=${res.finishReason ?? '-'}`,
        );
      if (res.finishReason === 'MAX_TOKENS')
        return { raw: undefined, problem: 'The reply was cut off; keep it shorter.' };
      const raw = parseModelJson(res.text);
      return raw === undefined ? { raw, problem: 'The reply was not valid JSON.' } : { raw, problem: null };
    }
  }

  async function runSingle<I, O>(
    task: SinglePromptTask<I, O>,
    input: I,
  ): Promise<{ value: O; calls: number; model: string }> {
    const base = task.build(input);
    const counter: Counter = { calls: 0, model: null };
    let problems: string[] = [];
    let lastError: AppError | null = null;
    for (let attempt = 1; attempt <= attemptsMax; attempt++) {
      if (attempt > 1) await backoff(attempt - 1);
      try {
        const { raw, problem } = await call(task, task.responseSchema, withFeedback(base, problems), counter);
        lastError = null;
        if (problem) {
          problems = [problem];
          deps.log?.(`${task.version} attempt=${attempt} ${problem}`);
          continue;
        }
        const result = task.validate(input, raw);
        if (result.ok) {
          deps.log?.(`${task.version} ok attempts=${attempt}`);
          return { value: result.value, calls: counter.calls, model: counter.model ?? '' };
        }
        problems = result.error;
        deps.log?.(`${task.version} attempt=${attempt} invalid (${problems.slice(0, 2).join('; ')})`);
      } catch (e) {
        const ae = toAppError(e);
        deps.log?.(
          `${task.version} attempt=${attempt} error=${ae.code} ${deps.describeError?.(e) ?? ''}`.trim(),
        );
        if (!ae.retryable) {
          deps.log?.(`${task.version} failed code=${ae.code} attempts=${attempt}`);
          throw ae;
        }
        lastError = ae;
        problems = [];
      }
    }
    const code = lastError ? lastError.code : 'AI_INVALID_OUTPUT';
    deps.log?.(`${task.version} failed code=${code} attempts=${attemptsMax}`);
    throw new AppError(code, { context: { task: task.id, attempts: attemptsMax } });
  }

  async function runBatch<Item, Shared, O>(
    task: BatchPromptTask<Item, Shared, O>,
    items: readonly Item[],
    shared: Shared,
  ): Promise<BatchRun<O>> {
    const results = new Map<string, O | null>();
    for (const item of items) results.set(task.keyOf(item), null);
    const size = Math.max(1, Math.min(task.maxBatch, config.batchSize));
    const counter: Counter = { calls: 0, model: null };
    let lastError: AppError | null = null;
    for (let start = 0; start < items.length; start += size) {
      let pending = items.slice(start, start + size);
      let problems: string[] = [];
      for (let attempt = 1; attempt <= attemptsMax && pending.length > 0; attempt++) {
        if (attempt > 1) await backoff(attempt - 1);
        try {
          const prompt = withFeedback(task.build(pending, shared), problems);
          const { raw, problem } = await call(task, task.responseSchema, prompt, counter);
          if (problem) {
            problems = [problem];
            deps.log?.(`${task.version} attempt=${attempt} ${problem}`);
            continue;
          }
          const outcome = task.validate(pending, shared, raw);
          for (const [key, value] of outcome.accepted) results.set(key, value);
          const rejected = new Set(outcome.rejected.map((r) => r.key));
          pending = pending.filter((i) => rejected.has(task.keyOf(i)));
          problems = outcome.rejected.map((r) => `${r.key}: ${r.reason}`);
          deps.log?.(
            `${task.version} attempt=${attempt} accepted=${outcome.accepted.size} rejected=${rejected.size}${problems.length > 0 ? ` (${problems.slice(0, 2).join('; ')})` : ''}`,
          );
        } catch (e) {
          const ae = toAppError(e);
          deps.log?.(
            `${task.version} attempt=${attempt} error=${ae.code} ${deps.describeError?.(e) ?? ''}`.trim(),
          );
          if (!ae.retryable) {
            deps.log?.(`${task.version} stopped code=${ae.code}`);
            return { results, error: ae, calls: counter.calls, model: counter.model };
          }
          lastError = ae;
          problems = [];
        }
      }
    }
    const unanswered = [...results.values()].some((v) => v === null);
    return { results, error: unanswered ? lastError : null, calls: counter.calls, model: counter.model };
  }

  return { runSingle, runBatch };
}
