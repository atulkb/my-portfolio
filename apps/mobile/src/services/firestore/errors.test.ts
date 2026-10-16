import { AppError } from '@portfolio/core';

import { mapFirestoreError } from './errors';

const sdkError = (code: string, message: string): Error => Object.assign(new Error(message), { code });

describe('mapFirestoreError', () => {
  it('maps SDK codes', () => {
    expect(mapFirestoreError(sdkError('firestore/permission-denied', 'x')).code).toBe('FS_PERMISSION');
    expect(mapFirestoreError(sdkError('firestore/unavailable', 'x')).code).toBe('FS_UNAVAILABLE');
    expect(mapFirestoreError(sdkError('resource-exhausted', 'x')).code).toBe('FS_QUOTA');
  });

  it('reads the gRPC status from transaction errors reported as unknown', () => {
    const e = sdkError(
      'firestore/unknown',
      '[firestore/unknown] PERMISSION_DENIED: Missing or insufficient permissions.',
    );
    expect(mapFirestoreError(e).code).toBe('FS_PERMISSION');
  });

  it('passes AppErrors through and falls back to APP_UNEXPECTED', () => {
    const app = new AppError('FS_INVALID_DOC');
    expect(mapFirestoreError(app)).toBe(app);
    expect(mapFirestoreError(new Error('boom')).code).toBe('APP_UNEXPECTED');
  });
});
