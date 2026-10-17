import {
  AIError,
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  type AI,
  type SchemaRequest,
} from '@react-native-firebase/ai';
import { getApp } from '@react-native-firebase/app';
import { getAuth } from '@react-native-firebase/auth';
import {
  AppError,
  type GenerateRequest,
  type GenerateResult,
  type GenerativePort,
  type JsonSchemaSubset,
  ruleCompileTask,
} from '@portfolio/core';

import { AI_CONFIG } from '@/config/ai';
import { getAppCheck } from '@/services/appCheck';

/** Finish reasons that mean the answer was withheld (no retry, LLD §3.5 step 5). */
const BLOCKED_FINISH = new Set(['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'RECITATION']);

/** Core's schema subset → the SDK's plain schema object (same OpenAPI shape, mutable arrays). */
export function toSdkSchema(s: JsonSchemaSubset): SchemaRequest {
  switch (s.type) {
    case 'object':
      return {
        ...s,
        properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toSdkSchema(v)])),
        required: s.required ? [...s.required] : undefined,
      } as SchemaRequest;
    case 'array':
      return { ...s, items: toSdkSchema(s.items) } as SchemaRequest;
    case 'string':
      return { ...s, enum: s.enum ? [...s.enum] : undefined } as SchemaRequest;
    default:
      return { ...s } as SchemaRequest;
  }
}

/** Maps an SDK or fetch failure to an `AI_*` AppError (LLD §3.5 steps 4–5, §5.2). */
export function mapAiError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof Error && (e.name === 'AbortError' || /timed? ?out|abort/i.test(e.message)))
    return new AppError('AI_TIMEOUT', { cause: e, retryable: true });
  if (e instanceof AIError) {
    const status = e.customErrorData?.status;
    if (status === 429) return new AppError('AI_RATE_LIMITED', { cause: e });
    // 401 = App Check token missing/invalid while enforcement is on; retrying cannot help.
    if (status === 401 || status === 403 || e.code === 'api-not-enabled')
      return new AppError('AI_NOT_AUTHORISED', { cause: e });
    if (status === 400) return new AppError('AI_UNAVAILABLE', { cause: e, context: { status } });
    // Model ID unknown to this project/backend: the client skips to the next model (HLD D36).
    if (status === 404) return new AppError('AI_UNAVAILABLE', { cause: e, context: { status } });
    if (e.customErrorData?.response?.promptFeedback?.blockReason)
      return new AppError('AI_BLOCKED', { cause: e });
    if (status !== undefined && status >= 500)
      return new AppError('AI_UNAVAILABLE', { cause: e, retryable: true, context: { status } });
    if (e.code === 'fetch-error') return new AppError('AI_UNAVAILABLE', { cause: e, retryable: true });
    if (e.code === 'response-error' && /block/i.test(e.message))
      return new AppError('AI_BLOCKED', { cause: e });
    return new AppError('AI_UNAVAILABLE', { cause: e, retryable: true });
  }
  return new AppError('AI_UNAVAILABLE', { cause: e, retryable: true });
}

/** Thinking levels from least to most; a model that rejects one gets the next (HLD D36). */
const LEVELS = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'] as const;
/** SDK thinking level. */
export type ThinkingLevel = (typeof LEVELS)[number];

/** "Thinking level MINIMAL is not supported for this model" → the rejected level. */
export function rejectedThinkingLevel(e: unknown): ThinkingLevel | null {
  const m = e instanceof Error ? /Thinking level (\w+) is not supported/i.exec(e.message) : null;
  const level = m?.[1]?.toUpperCase();
  return LEVELS.find((l) => l === level) ?? null;
}

/** The next level up, or `null` above HIGH. */
function nextLevel(level: ThinkingLevel): ThinkingLevel | null {
  return LEVELS[LEVELS.indexOf(level) + 1] ?? null;
}

/**
 * The task's thinking level raised to the model's `minThinkingLevel` from `AI_CONFIG.modelChain`
 * (found with the dev model probe and kept in the repo, never learnt into the cache).
 */
export function levelFor(model: string, taskId: GenerateRequest['taskId']): ThinkingLevel {
  const wanted: ThinkingLevel = AI_CONFIG.thinkingLevel[taskId];
  const floor = AI_CONFIG.modelChain.find((m) => m.id === model)?.minThinkingLevel;
  return floor && LEVELS.indexOf(floor) > LEVELS.indexOf(wanted) ? floor : wanted;
}

/**
 * Runs one request, stepping the thinking level up when the model rejects it (bounded by the
 * four levels). The step-up is not remembered: a model that needs it should get
 * `minThinkingLevel` in `AI_CONFIG.modelChain`. Returns the reply and the level that was accepted.
 */
async function withLevelStepUp(
  req: GenerateRequest,
  start: ThinkingLevel,
): Promise<{ result: GenerateResult; level: ThinkingLevel }> {
  let level = start;
  for (;;) {
    try {
      return { result: await generateOnce(req, level), level };
    } catch (e) {
      const up = rejectedThinkingLevel(e) === level ? nextLevel(level) : null;
      if (!up) throw e;
      level = up;
    }
  }
}

let ai: AI | null = null;

/**
 * Gemini through Firebase AI Logic (Gemini Developer API backend) with App Check (debug provider,
 * see `services/appCheck.ts`). The only file importing `@react-native-firebase/ai` (LLD §3.5).
 */
export const firebaseGenerativePort: GenerativePort = {
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    try {
      return (await withLevelStepUp(req, levelFor(req.model, req.taskId))).result;
    } catch (e) {
      throw mapAiError(e);
    }
  },
};

/** Outcome of probing one model of the chain (dev diagnostics). */
export type ModelProbeResult = {
  readonly model: string;
  readonly outcome: 'OK' | 'NOT_FOUND' | 'RATE_LIMITED' | 'ERROR';
  /** Lowest thinking level the model accepted (`OK` only). */
  readonly minLevel: ThinkingLevel | null;
  readonly ms: number;
  /** Error code / SDK message for failures; token counts for `OK`. Never the prompt or reply. */
  readonly detail: string;
};

/**
 * Dev probe (HLD D36): sends one small rule-compile request to `model`, starting at the lowest
 * thinking level, and reports whether the model exists, its quota state and the lowest level it
 * accepts, so `AI_CONFIG.modelChain` can be kept correct in the repo.
 */
export async function probeModel(model: string): Promise<ModelProbeResult> {
  const started = Date.now();
  const req: GenerateRequest = {
    taskId: ruleCompileTask.id,
    model,
    prompt: ruleCompileTask.build({
      text: 'RSI below 30',
      appliesToPortfolio: true,
      appliesToWatchlists: true,
    }),
    responseSchema: ruleCompileTask.responseSchema,
    timeoutMs: AI_CONFIG.requestTimeoutMs,
  };
  try {
    const { result, level } = await withLevelStepUp(req, 'MINIMAL');
    const u = result.usage;
    return {
      model,
      outcome: 'OK',
      minLevel: level,
      ms: Date.now() - started,
      detail: u ? `in=${u.promptTokens} out=${u.outputTokens} thoughts=${u.thoughtsTokens}` : '',
    };
  } catch (e) {
    const ae = mapAiError(e);
    const status = ae.context['status'];
    const outcome = ae.code === 'AI_RATE_LIMITED' ? 'RATE_LIMITED' : status === 404 ? 'NOT_FOUND' : 'ERROR';
    const msg = e instanceof Error ? e.message.slice(0, 160) : String(e);
    return { model, outcome, minLevel: null, ms: Date.now() - started, detail: `${ae.code}: ${msg}` };
  }
}

/** One SDK call; errors are mapped by the caller. */
async function generateOnce(req: GenerateRequest, level: ThinkingLevel): Promise<GenerateResult> {
  // App Check token (enforced for AI Logic) + the signed-in user (for authenticated-users mode).
  ai ??= getAI(getApp(), { backend: new GoogleAIBackend(), appCheck: getAppCheck(), auth: getAuth() });
  const model = getGenerativeModel(
    ai,
    {
      model: req.model,
      systemInstruction: req.prompt.system,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: toSdkSchema(req.responseSchema),
        temperature: AI_CONFIG.temperature[req.taskId],
        maxOutputTokens: AI_CONFIG.maxOutputTokens[req.taskId],
        thinkingConfig: { thinkingLevel: level },
      },
    },
    { timeout: req.timeoutMs },
  );
  const { response } = await model.generateContent(req.prompt.user);
  if (response.promptFeedback?.blockReason) throw new AppError('AI_BLOCKED');
  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason ?? null;
  if (finishReason && BLOCKED_FINISH.has(finishReason)) throw new AppError('AI_BLOCKED');
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !('thought' in p && p.thought === true))
    .map((p) => ('text' in p && typeof p.text === 'string' ? p.text : ''))
    .join('');
  const u = response.usageMetadata;
  return {
    text,
    finishReason,
    usage: u
      ? {
          promptTokens: u.promptTokenCount,
          outputTokens: u.candidatesTokenCount,
          thoughtsTokens: u.thoughtsTokenCount ?? 0,
        }
      : null,
  };
}
