import { performanceRatingTask } from '@portfolio/core';

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
import { AIError } from '@react-native-firebase/ai';
// eslint-disable-next-line import/first
import { mapAiError, toSdkSchema } from './firebaseAi';

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
