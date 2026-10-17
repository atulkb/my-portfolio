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
} from '@portfolio/core';

import { AI_CONFIG, THINKING_BUDGET } from '@/config/ai';
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
type Level = (typeof LEVELS)[number];
/** Per model: the lowest level it accepted after a rejection (memory only, re-learnt per launch). */
const minLevel = new Map<string, Level>();

/** "Thinking level MINIMAL is not supported for this model" → the rejected level. */
export function rejectedThinkingLevel(e: unknown): Level | null {
  const m = e instanceof Error ? /Thinking level (\w+) is not supported/i.exec(e.message) : null;
  const level = m?.[1]?.toUpperCase();
  return LEVELS.find((l) => l === level) ?? null;
}

/** Gemini 3.x takes a thinking level (raised to the model's minimum); Gemini 2.5 a token budget. */
function thinkingFor(model: string, taskId: GenerateRequest['taskId']) {
  const wanted: Level = AI_CONFIG.thinkingLevel[taskId];
  const style = AI_CONFIG.modelChain.find((m) => m.id === model)?.thinking ?? 'level';
  if (style === 'budget') return { thinkingBudget: THINKING_BUDGET[wanted] };
  const floor = minLevel.get(model);
  const level = floor && LEVELS.indexOf(floor) > LEVELS.indexOf(wanted) ? floor : wanted;
  return { thinkingLevel: level };
}

let ai: AI | null = null;

/**
 * Gemini through Firebase AI Logic (Gemini Developer API backend) with App Check (debug provider,
 * see `services/appCheck.ts`). The only file importing `@react-native-firebase/ai` (LLD §3.5).
 */
export const firebaseGenerativePort: GenerativePort = {
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    try {
      return await generateOnce(req);
    } catch (e) {
      // Not every model supports every thinking level: step up once per rejected level and
      // remember it for the model (bounded by the 4 levels).
      const rejected = rejectedThinkingLevel(e);
      const next = rejected ? LEVELS[LEVELS.indexOf(rejected) + 1] : undefined;
      if (next) {
        minLevel.set(req.model, next);
        return firebaseGenerativePort.generate(req);
      }
      throw mapAiError(e);
    }
  },
};

/** One SDK call; errors are mapped by the caller. */
async function generateOnce(req: GenerateRequest): Promise<GenerateResult> {
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
        thinkingConfig: thinkingFor(req.model, req.taskId),
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
