import { performanceRatingTask, ruleCompileTask } from '@portfolio/core';

jest.mock('@react-native-firebase/app', () => ({ getApp: jest.fn() }));
jest.mock('@react-native-firebase/auth', () => ({ getAuth: jest.fn() }));
jest.mock('@/services/appCheck', () => ({ getAppCheck: jest.fn() }));
jest.mock('@react-native-firebase/ai', () => {
  class AIError extends Error {
    code: string;
    customErrorData?: { status?: number };
    constructor(code: string, message: string, data?: { status?: number }) {
      super(message);
      this.code = code;
      this.customErrorData = data;
    }
  }
  return { AIError, getAI: jest.fn(), getGenerativeModel: jest.fn(), GoogleAIBackend: jest.fn() };
});

// eslint-disable-next-line import/first -- must load after the mocks above
import { AIError, getGenerativeModel } from '@react-native-firebase/ai';
// eslint-disable-next-line import/first
import {
  firebaseGenerativePort,
  levelFor,
  mapAiError,
  rejectedThinkingLevel,
  toSdkSchema,
} from './firebaseAi';

type MockAIError = new (code: string, message: string, data?: { status?: number }) => Error;
const aiError = (code: string, status?: number) =>
  new (AIError as unknown as MockAIError)(code, 'x', status === undefined ? undefined : { status });

describe('firebaseAi', () => {
  it('converts core schemas to the SDK shape (enums and required kept)', () => {
    const s = toSdkSchema(performanceRatingTask.responseSchema) as {
      properties: { ratings: { items: { properties: { rating: { enum: string[] } }; required: string[] } } };
    };
    expect(s.properties.ratings.items.properties.rating.enum).toEqual(['GOOD', 'AVERAGE', 'BAD']);
    expect(s.properties.ratings.items.required).toContain('reason');
  });

  it.each([
    [429, 'AI_RATE_LIMITED', false],
    [401, 'AI_NOT_AUTHORISED', false],
    [403, 'AI_NOT_AUTHORISED', false],
    [400, 'AI_UNAVAILABLE', false],
    [503, 'AI_UNAVAILABLE', true],
  ])('maps HTTP %i to %s (retryable %s)', (status, code, retryable) => {
    const e = mapAiError(aiError('fetch-error', status));
    expect(e.code).toBe(code);
    expect(e.retryable).toBe(retryable);
  });

  it('maps API-not-enabled and timeouts', () => {
    expect(mapAiError(aiError('api-not-enabled')).code).toBe('AI_NOT_AUTHORISED');
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(mapAiError(abort)).toMatchObject({ code: 'AI_TIMEOUT', retryable: true });
  });
});

describe('thinking level rejection', () => {
  it('reads the rejected level from the API message', () => {
    expect(
      rejectedThinkingLevel(
        new Error(
          '[400 ] Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.',
        ),
      ),
    ).toBe('MINIMAL');
    expect(rejectedThinkingLevel(new Error('[400 ] Bad schema'))).toBeNull();
    expect(rejectedThinkingLevel('nope')).toBeNull();
  });
});

describe('thinking level per model (config in the repo, HLD D36)', () => {
  const rejection = new Error('[400 ] Thinking level MINIMAL is not supported for this model.');
  const req = {
    taskId: 'ruleCompile' as const,
    model: 'gemini-3.5-flash-lite',
    prompt: { system: 's', user: 'u' },
    responseSchema: ruleCompileTask.responseSchema,
    timeoutMs: 1000,
  };

  /** Fakes the SDK: rejects MINIMAL, answers otherwise; records each thinking config sent. */
  function fakeSdk(): unknown[] {
    const sent: unknown[] = [];
    jest.mocked(getGenerativeModel).mockImplementation((_ai, params) => {
      const thinking = params.generationConfig?.thinkingConfig;
      sent.push(thinking);
      const generateContent = () =>
        thinking?.thinkingLevel === 'MINIMAL'
          ? Promise.reject(rejection)
          : Promise.resolve({ response: { candidates: [{ content: { parts: [{ text: '{}' }] } }] } });
      return { generateContent } as unknown as ReturnType<typeof getGenerativeModel>;
    });
    return sent;
  }

  it('raises the task level to the model minimum from the config', () => {
    expect(levelFor('gemini-3.8-flash', 'signals')).toBe('LOW');
    expect(levelFor('gemini-3.5-flash-lite', 'signals')).toBe('MINIMAL');
    expect(levelFor('gemini-3.5-flash-lite', 'deepAnalysis')).toBe('LOW');
    expect(levelFor('unknown-model', 'signals')).toBe('MINIMAL');
  });

  it('steps up a rejected level for that request only, without remembering it', async () => {
    const sent = fakeSdk();
    const signals = { ...req, taskId: 'signals' as const };
    await firebaseGenerativePort.generate(signals);
    await firebaseGenerativePort.generate(signals);
    expect(sent).toEqual([
      { thinkingLevel: 'MINIMAL' },
      { thinkingLevel: 'LOW' },
      { thinkingLevel: 'MINIMAL' },
      { thinkingLevel: 'LOW' },
    ]);
  });
});
